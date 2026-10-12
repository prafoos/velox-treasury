// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVeloxStrategyAdapter} from "./interfaces/IVeloxStrategyAdapter.sol";

/// @notice Non-upgradeable, single-asset treasury core with user liabilities and bounded strategy adapters.
contract VeloxTreasuryCore is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint64 public constant TIMELOCK_DELAY = 2 days;

    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");
    bytes32 public constant TIMELOCK_EXECUTOR_ROLE = keccak256("TIMELOCK_EXECUTOR_ROLE");
    bytes32 public constant AUTOMATION_ROLE = keccak256("AUTOMATION_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    enum OperationKind {
        RiskPolicy,
        ProtocolApproval,
        AssetApproval,
        StrategyApproval,
        BucketPolicy,
        WithdrawalPolicy
    }

    enum ValuationStatus {
        Unavailable,
        Current,
        Stale,
        Impaired
    }

    struct RiskPolicy {
        uint256 minimumLiquidReserve;
        uint16 minimumLiquidReserveBps;
        uint256 maximumTotalDeployed;
    }

    struct BucketPolicy {
        uint16 liquidOperationalReserveBps;
        uint16 yieldStrategyBufferBps;
        uint16 sweepLiquidityBufferBps;
        uint16 automationAgentPoolBps;
    }

    struct ExposureCap {
        uint256 absoluteCap;
        uint16 relativeCapBps;
        bool approved;
        bool enabled;
    }

    struct StrategyConfig {
        bytes32 protocol;
        address asset;
        uint256 absoluteCap;
        uint16 relativeCapBps;
        uint256 principal;
        uint256 shares;
        uint256 position;
        uint256 realizedYield;
        uint256 realizedLoss;
        uint256 feesAccrued;
        uint256 withdrawalShortfall;
        uint256 lastValuationBlock;
        address valuationSource;
        ValuationStatus valuationStatus;
        bool approved;
        bool enabled;
    }

    struct UserFinancialState {
        uint256 principal;
        uint256 currentValue;
        int256 unrealizedPnl;
        int256 realizedPnl;
        int256 totalPnl;
        uint256 immediatelyWithdrawableValue;
    }

    struct PendingOperation {
        OperationKind kind;
        uint64 eta;
        address subject;
        bytes32 secondary;
        address tertiary;
        uint256 value1;
        uint256 value2;
        uint16 bps;
        uint16 bps2;
        uint16 bps3;
        uint16 bps4;
    }

    error InvalidAddress();
    error InvalidAmount();
    error InvalidRecipient();
    error InvalidBasisPoints();
    error InvalidCap();
    error InvalidPolicyChange();
    error NotApproved();
    error Disabled();
    error InsufficientUserBalance(uint256 requested, uint256 available);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error LiquidityRequirementBreached(uint256 liquidAfter, uint256 required);
    error TotalDeployedCapExceeded(uint256 requested, uint256 available);
    error ExposureCapExceeded(address subject, uint256 requested, uint256 allowed);
    error StrategyMismatch();
    error StrategyPositionExceeded();
    error TimelockNotReady(bytes32 operationId, uint256 readyAt);
    error TimelockMissing(bytes32 operationId);
    error TimelockAlreadyExists(bytes32 operationId);
    error TimelockDelayTooShort();
    error UnexpectedTokenDelta(uint256 expected, uint256 actual);
    error InvalidOperation();
    error ValuationUnavailable();
    error ValuationNotCurrent();
    error ActiveStrategy();
    error InvalidShares();
    error InvalidUnwindPlan();
    error InvalidBucketAllocationTotal(uint256 totalBps);
    error YieldStrategyBufferExceeded(uint256 requested, uint256 allowed);
    error InvalidValuationFreshness();
    error ProtocolVaultAlreadyConfigured();
    error WithdrawalLimitExceeded(uint256 requested, uint256 available);

    IERC20 public immutable usdc;
    RiskPolicy private _riskPolicy;
    BucketPolicy private _bucketPolicy;
    uint256 private _totalUserUnits;
    uint256 public totalDeployed;
    uint256 public approvedProtocolCount;
    uint256 public approvedAssetCount;
    uint256 public approvedStrategyCount;
    uint256 public valuationFreshnessBlocks;
    uint256 private _operationNonce;
    uint256 public maximumSingleWithdrawal;
    uint256 public dailyOutflowCap;
    uint64 private _outflowWindow;
    uint256 private _outflowSpent;

    mapping(address => uint256) private _userUnits;
    mapping(address => uint256) private _userPrincipal;
    mapping(address => int256) private _userRealizedPnl;
    mapping(bytes32 => ExposureCap) public protocolCaps;
    mapping(address => ExposureCap) public assetCaps;
    mapping(bytes32 => uint256) public protocolExposure;
    mapping(address => uint256) public assetExposure;
    mapping(bytes32 => address) public protocolVaults;
    mapping(address => StrategyConfig) public strategies;
    mapping(bytes32 => PendingOperation) public pendingOperations;

    event Deposit(address indexed user, uint256 amount, uint256 userBalance, uint256 totalLiabilities);
    event Withdrawal(address indexed user, address indexed recipient, uint256 amount, uint256 userBalance, uint256 totalLiabilities);
    event UserFinancialStateChanged(
        address indexed user,
        uint256 principal,
        uint256 currentValue,
        int256 unrealizedPnl,
        int256 realizedPnl,
        int256 totalPnl,
        uint256 immediatelyWithdrawableValue
    );
    event TreasuryNAVChanged(uint256 totalManagedAssets, uint256 totalUserLiabilities, uint256 totalDeployed, uint256 liquidUSDC);
    event RiskPolicyChanged(RiskPolicy policy, address indexed changedBy, bool immediate);
    event WithdrawalPolicyChanged(uint256 maximumSingleWithdrawal, uint256 dailyOutflowCap, address indexed changedBy, bool immediate);
    event BucketPolicyChanged(BucketPolicy policy, address indexed changedBy, bool immediate);
    event AllocationChanged(address indexed strategy, uint256 amount, uint256 position, uint256 totalDeployed);
    event StrategyDeallocated(address indexed strategy, uint256 amount, uint256 position, uint256 totalDeployed, bool emergency);
    event ProtocolExposureChanged(bytes32 indexed protocol, uint256 exposure, uint256 absoluteCap, uint16 relativeCapBps);
    event AssetExposureChanged(address indexed asset, uint256 exposure, uint256 absoluteCap, uint16 relativeCapBps);
    event TimelockScheduled(bytes32 indexed operationId, OperationKind indexed kind, uint64 eta);
    event TimelockExecuted(bytes32 indexed operationId, OperationKind indexed kind);
    event TimelockCancelled(bytes32 indexed operationId, OperationKind indexed kind);
    event ProtocolApprovalChanged(bytes32 indexed protocol, bool approved, bool enabled);
    event AssetApprovalChanged(address indexed asset, bool approved, bool enabled);
    event StrategyApprovalChanged(address indexed strategy, bytes32 indexed protocol, address indexed asset, bool approved, bool enabled);
    event EmergencyPause(address indexed account);
    event EmergencyDeallocation(address indexed strategy, uint256 amount, address indexed account);
    event AutomationExecuted(address indexed strategy, uint256 amount, bool deallocation);
    event StrategyValuationUpdated(address indexed strategy, uint256 value, uint256 shares, uint256 fees, uint256 blockNumber, ValuationStatus status);
    event StrategyValuationStatusChanged(address indexed strategy, ValuationStatus status);
    event ValuationFreshnessConfigured(uint256 freshnessBlocks);
    event ProtocolVaultConfigured(bytes32 indexed protocol, address indexed vault);
    event StrategyAccountingUpdated(
        address indexed strategy,
        uint256 principal,
        uint256 shares,
        uint256 currentValue,
        uint256 realizedYield,
        uint256 realizedLoss,
        uint256 withdrawalShortfall,
        uint256 totalDeployed,
        uint256 valuationBlock,
        ValuationStatus status
    );

    constructor(
        address usdc_,
        address governance,
        address policyAdmin,
        address timelockExecutor,
        address automationExecutor,
        address emergency,
        RiskPolicy memory initialRiskPolicy,
        BucketPolicy memory initialBucketPolicy,
        uint256 initialValuationFreshnessBlocks
    ) {
        if (
            usdc_ == address(0)
                || usdc_.code.length == 0
                || governance == address(0)
                || policyAdmin == address(0)
                || timelockExecutor == address(0)
                || automationExecutor == address(0)
                || emergency == address(0)
        ) revert InvalidAddress();
        if (
            governance == policyAdmin
                || governance == timelockExecutor
                || governance == automationExecutor
                || governance == emergency
                || policyAdmin == timelockExecutor
                || policyAdmin == automationExecutor
                || policyAdmin == emergency
                || timelockExecutor == automationExecutor
                || timelockExecutor == emergency
                || automationExecutor == emergency
        ) revert InvalidAddress();
        if (initialRiskPolicy.minimumLiquidReserveBps > BPS) revert InvalidBasisPoints();
        _validateBucketPolicy(initialBucketPolicy);
        if (initialValuationFreshnessBlocks == 0) revert InvalidValuationFreshness();

        usdc = IERC20(usdc_);
        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(POLICY_ADMIN_ROLE, policyAdmin);
        _grantRole(TIMELOCK_EXECUTOR_ROLE, timelockExecutor);
        _grantRole(AUTOMATION_ROLE, automationExecutor);
        _grantRole(EMERGENCY_ROLE, emergency);
        _riskPolicy = initialRiskPolicy;
        _bucketPolicy = initialBucketPolicy;
        valuationFreshnessBlocks = initialValuationFreshnessBlocks;
    }

    function riskPolicy() external view returns (RiskPolicy memory) {
        return _riskPolicy;
    }

    function bucketPolicy() external view returns (BucketPolicy memory) {
        return _bucketPolicy;
    }

    function configureValuationFreshness(uint256 freshnessBlocks) external onlyRole(POLICY_ADMIN_ROLE) {
        if (freshnessBlocks == 0 || valuationFreshnessBlocks != 0) revert InvalidValuationFreshness();
        valuationFreshnessBlocks = freshnessBlocks;
        emit ValuationFreshnessConfigured(freshnessBlocks);
    }

    function configureProtocolVault(bytes32 protocol, address vaultAddress) external onlyRole(POLICY_ADMIN_ROLE) {
        if (protocol == bytes32(0) || vaultAddress == address(0) || vaultAddress.code.length == 0) revert InvalidAddress();
        if (protocolVaults[protocol] != address(0)) revert ProtocolVaultAlreadyConfigured();
        protocolVaults[protocol] = vaultAddress;
        emit ProtocolVaultConfigured(protocol, vaultAddress);
    }

    function bucketTargets()
        public
        view
        returns (
            uint256 liquidOperationalReserve,
            uint256 yieldStrategyBuffer,
            uint256 sweepLiquidityBuffer,
            uint256 automationAgentPool
        )
    {
        uint256 assets = totalManagedAssets();
        liquidOperationalReserve = assets * _bucketPolicy.liquidOperationalReserveBps / BPS;
        yieldStrategyBuffer = assets * _bucketPolicy.yieldStrategyBufferBps / BPS;
        sweepLiquidityBuffer = assets * _bucketPolicy.sweepLiquidityBufferBps / BPS;
        automationAgentPool = assets * _bucketPolicy.automationAgentPoolBps / BPS;
    }

    function yieldStrategyBufferCapacity() public view returns (uint256) {
        (, uint256 target,,) = bucketTargets();
        return target > totalDeployed ? target - totalDeployed : 0;
    }

    function liquidBucketClassifications()
        public
        view
        returns (uint256 liquidOperationalReserve, uint256 sweepLiquidityBuffer, uint256 automationAgentPool)
    {
        uint256 liquid = liquidUSDC();
        uint256 flexibleBps = uint256(_bucketPolicy.sweepLiquidityBufferBps) + _bucketPolicy.automationAgentPoolBps;
        if (flexibleBps == 0) {
            return (liquid, 0, 0);
        }

        liquidOperationalReserve = requiredLiquidReserve();
        if (liquidOperationalReserve > liquid) liquidOperationalReserve = liquid;
        uint256 remaining = liquid - liquidOperationalReserve;
        sweepLiquidityBuffer = remaining * _bucketPolicy.sweepLiquidityBufferBps / flexibleBps;
        automationAgentPool = remaining - sweepLiquidityBuffer;
    }

    function userBalance(address user) public view returns (uint256) {
        if (_totalUserUnits == 0) return 0;
        return _userUnits[user] * totalManagedAssets() / _totalUserUnits;
    }

    function userStrategyPosition(address user, address strategy) public view returns (uint256 shares, uint256 position) {
        uint256 totalUserUnits = _totalUserUnits;
        if (totalUserUnits == 0) return (0, 0);
        uint256 userUnits = _userUnits[user];
        StrategyConfig storage config = strategies[strategy];
        shares = Math.mulDiv(config.shares, userUnits, totalUserUnits);
        position = Math.mulDiv(config.position, userUnits, totalUserUnits);
    }

    function userPrincipal(address user) external view returns (uint256) {
        return _userPrincipal[user];
    }

    function userRealizedPnl(address user) external view returns (int256) {
        return _userRealizedPnl[user];
    }

    function userFinancialState(address user) public view returns (UserFinancialState memory state) {
        state.principal = _userPrincipal[user];
        state.currentValue = userBalance(user);
        state.unrealizedPnl = int256(state.currentValue) - int256(state.principal);
        state.realizedPnl = _userRealizedPnl[user];
        state.totalPnl = state.unrealizedPnl + state.realizedPnl;
        if (paused()) return state;
        state.immediatelyWithdrawableValue = _immediatelyWithdrawableValue(
            state.currentValue,
            liquidUSDC(),
            totalManagedAssets()
        );
    }

    function immediatelyWithdrawableValue(address user) external view returns (uint256) {
        if (paused()) return 0;
        return _immediatelyWithdrawableValue(userBalance(user), liquidUSDC(), totalManagedAssets());
    }

    function totalUserLiabilities() public view returns (uint256) {
        return _totalUserUnits == 0 ? 0 : totalManagedAssets();
    }

    function liquidUSDC() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function requiredLiquidReserve() public view returns (uint256) {
        uint256 relativeReserve = totalUserLiabilities() * _riskPolicy.minimumLiquidReserveBps / BPS;
        (uint256 operationalReserve,,,) = bucketTargets();
        return Math.max(_riskPolicy.minimumLiquidReserve, Math.max(relativeReserve, operationalReserve));
    }

    function availableLiquidity() public view returns (uint256) {
        uint256 liquid = liquidUSDC();
        uint256 required = requiredLiquidReserve();
        return liquid > required ? liquid - required : 0;
    }

    function totalManagedAssets() public view returns (uint256) {
        return liquidUSDC() + totalDeployed;
    }

    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 assetsBefore = totalManagedAssets();
        uint256 beforeBalance = liquidUSDC();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = liquidUSDC();
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != amount) revert UnexpectedTokenDelta(amount, received);
        uint256 mintedUnits = _totalUserUnits == 0 || assetsBefore == 0
            ? amount
            : amount * _totalUserUnits / assetsBefore;
        if (mintedUnits == 0) revert InvalidAmount();
        _userUnits[msg.sender] += mintedUnits;
        _totalUserUnits += mintedUnits;
        _userPrincipal[msg.sender] += amount;
        emit Deposit(msg.sender, amount, userBalance(msg.sender), totalUserLiabilities());
        _emitUserFinancialState(msg.sender);
        _emitTreasuryNAV();
    }

    function withdraw(uint256 amount, address recipient) external whenNotPaused nonReentrant {
        if (recipient != msg.sender) revert InvalidRecipient();
        _withdrawLiquid(amount, recipient);
    }

    function withdrawWithDeallocation(
        uint256 amount,
        address recipient,
        address[] calldata strategiesToUnwind,
        uint256[] calldata sharesToUnwind
    ) external whenNotPaused nonReentrant {
        if (recipient != msg.sender) revert InvalidRecipient();
        if (amount <= liquidUSDC()) {
            _withdrawLiquid(amount, recipient);
            return;
        }

        uint256 currentBalance = userBalance(msg.sender);
        if (amount > currentBalance) revert InsufficientUserBalance(amount, currentBalance);
        bool withdrawingAll = amount == currentBalance;

        if (strategiesToUnwind.length != sharesToUnwind.length) {
            revert InvalidUnwindPlan();
        }

        for (uint256 index = 0; index < strategiesToUnwind.length; index++) {
            address strategy = strategiesToUnwind[index];
            if (strategy == address(0) || sharesToUnwind[index] == 0) revert InvalidUnwindPlan();
            StrategyConfig storage config = strategies[strategy];
            if (!config.approved) revert NotApproved();
            for (uint256 previous = 0; previous < index; previous++) {
                if (strategiesToUnwind[previous] == strategy) revert InvalidUnwindPlan();
            }
            (uint256 userShares,) = userStrategyPosition(msg.sender, strategy);
            if (sharesToUnwind[index] > userShares) {
                revert InvalidUnwindPlan();
            }
            _deallocate(strategy, sharesToUnwind[index], false);
        }

        if (withdrawingAll) amount = userBalance(msg.sender);
        _withdrawLiquid(amount, recipient);
    }

    function _withdrawLiquid(uint256 amount, address recipient) private {
        if (amount == 0) revert InvalidAmount();
        uint256 currentBalance = userBalance(msg.sender);
        if (amount > currentBalance) revert InsufficientUserBalance(amount, currentBalance);
        uint256 liquid = liquidUSDC();
        if (amount > liquid) revert InsufficientLiquidity(amount, liquid);

        uint256 unitsToBurn = amount == currentBalance
            ? _userUnits[msg.sender]
            : (amount * _totalUserUnits + totalManagedAssets() - 1) / totalManagedAssets();
        uint256 principalBefore = _userPrincipal[msg.sender];
        uint256 unitsBefore = _userUnits[msg.sender];
        uint256 principalReduction = Math.mulDiv(principalBefore, unitsToBurn, unitsBefore);
        _userPrincipal[msg.sender] = principalBefore - principalReduction;
        _userRealizedPnl[msg.sender] += int256(amount) - int256(principalReduction);
        uint256 requiredAfter = _requiredLiquidReserveAfter(amount, totalManagedAssets());
        if (liquid - amount < requiredAfter) revert LiquidityRequirementBreached(liquid - amount, requiredAfter);
        _recordOutflow(amount);

        _userUnits[msg.sender] -= unitsToBurn;
        _totalUserUnits -= unitsToBurn;
        uint256 beforeBalance = liquidUSDC();
        usdc.safeTransfer(recipient, amount);
        uint256 afterBalance = liquidUSDC();
        uint256 debited = beforeBalance >= afterBalance ? beforeBalance - afterBalance : 0;
        if (debited != amount) revert UnexpectedTokenDelta(amount, debited);
        emit Withdrawal(msg.sender, recipient, amount, userBalance(msg.sender), totalUserLiabilities());
        _emitUserFinancialState(msg.sender);
        _emitTreasuryNAV();
    }

    function allocateToStrategy(address strategy, uint256 amount) external whenNotPaused nonReentrant onlyRole(AUTOMATION_ROLE) {
        if (amount == 0) revert InvalidAmount();
        StrategyConfig storage config = strategies[strategy];
        if (!config.approved) revert NotApproved();
        if (!config.enabled) revert Disabled();
        if (!protocolCaps[config.protocol].enabled || !assetCaps[config.asset].enabled) revert NotApproved();
        if (!_isValuationCurrent(config)) revert ValuationNotCurrent();
        _assertStrategyIdentity(strategy, config.protocol, config.asset);
        _checkAllocation(config, amount);

        uint256 liquidBefore = liquidUSDC();
        if (amount > availableLiquidity()) revert InsufficientLiquidity(amount, availableLiquidity());
        uint256 availableDeployment = _riskPolicy.maximumTotalDeployed > totalDeployed
            ? _riskPolicy.maximumTotalDeployed - totalDeployed
            : 0;
        if (amount > availableDeployment) {
            revert TotalDeployedCapExceeded(amount, availableDeployment);
        }

        usdc.forceApprove(strategy, amount);
        uint256 sharesReceived = IVeloxStrategyAdapter(strategy).deposit(amount);
        usdc.forceApprove(strategy, 0);
        if (liquidBefore - liquidUSDC() != amount || sharesReceived == 0) revert UnexpectedTokenDelta(amount, liquidBefore - liquidUSDC());
        uint256 shares = IVeloxStrategyAdapter(strategy).sharesOfCore();
        uint256 value = IVeloxStrategyAdapter(strategy).currentValue();
        uint256 fees = IVeloxStrategyAdapter(strategy).feesAccrued();
        if (shares < sharesReceived) revert ValuationUnavailable();
        config.principal += amount;
        _setStrategyValuation(config, value, shares, fees, strategy);
        emit AllocationChanged(strategy, amount, config.position, totalDeployed);
        _emitExposureChanges(config);
        emit AutomationExecuted(strategy, amount, false);
        _emitStrategyAccounting(strategy, config);
        _emitTreasuryNAV();
    }

    function deallocateFromStrategy(address strategy, uint256 shares) external nonReentrant onlyRole(AUTOMATION_ROLE) {
        _deallocate(strategy, shares, false);
        emit AutomationExecuted(strategy, shares, true);
    }

    function emergencyDeallocate(address strategy, uint256 shares) external nonReentrant onlyRole(EMERGENCY_ROLE) {
        _deallocate(strategy, shares, true);
        emit EmergencyDeallocation(strategy, shares, msg.sender);
    }

    function _deallocate(address strategy, uint256 shareAmount, bool emergency) private {
        if (shareAmount == 0) revert InvalidShares();
        StrategyConfig storage config = strategies[strategy];
        if (!config.approved) revert NotApproved();
        if (!_isValuationCurrent(config)) revert ValuationNotCurrent();
        if (shareAmount > config.shares) revert StrategyPositionExceeded();
        uint256 previousShares = config.shares;
        uint256 requestedValue = IVeloxStrategyAdapter(strategy).previewRedeem(shareAmount);
        uint256 principalBasis = shareAmount == previousShares
            ? config.principal
            : config.principal * shareAmount / previousShares;
        uint256 liquidBefore = liquidUSDC();
        uint256 received = IVeloxStrategyAdapter(strategy).withdrawShares(shareAmount, address(this));
        uint256 liquidAfter = liquidUSDC();
        uint256 actualReceived = liquidAfter >= liquidBefore ? liquidAfter - liquidBefore : 0;
        if (received != actualReceived) revert UnexpectedTokenDelta(received, actualReceived);
        config.principal -= principalBasis;
        if (actualReceived >= principalBasis) config.realizedYield += actualReceived - principalBasis;
        else config.realizedLoss += principalBasis - actualReceived;
        if (actualReceived < requestedValue) config.withdrawalShortfall += requestedValue - actualReceived;
        uint256 shares = IVeloxStrategyAdapter(strategy).sharesOfCore();
        uint256 value = IVeloxStrategyAdapter(strategy).currentValue();
        uint256 fees = IVeloxStrategyAdapter(strategy).feesAccrued();
        _setStrategyValuation(config, value, shares, fees, strategy);
        emit StrategyDeallocated(strategy, actualReceived, config.position, totalDeployed, emergency);
        _emitExposureChanges(config);
        _emitStrategyAccounting(strategy, config);
        _emitTreasuryNAV();
    }

    function syncStrategyValuation(address strategy) external whenNotPaused onlyRole(AUTOMATION_ROLE) nonReentrant {
        StrategyConfig storage config = strategies[strategy];
        if (!config.approved) revert NotApproved();
        _assertStrategyIdentity(strategy, config.protocol, config.asset);
        uint256 value = IVeloxStrategyAdapter(strategy).currentValue();
        uint256 shares = IVeloxStrategyAdapter(strategy).sharesOfCore();
        uint256 fees = IVeloxStrategyAdapter(strategy).feesAccrued();
        if (shares == 0 && value != 0) revert ValuationUnavailable();
        _setStrategyValuation(config, value, shares, fees, strategy);
        emit StrategyValuationUpdated(strategy, value, shares, fees, block.number, ValuationStatus.Current);
        _emitStrategyAccounting(strategy, config);
        _emitTreasuryNAV();
    }

    function markStrategyValuationStale(address strategy) external onlyRole(AUTOMATION_ROLE) {
        StrategyConfig storage config = strategies[strategy];
        if (!config.approved) revert NotApproved();
        config.valuationStatus = ValuationStatus.Stale;
        emit StrategyValuationStatusChanged(strategy, ValuationStatus.Stale);
    }

    function _setStrategyValue(StrategyConfig storage config, uint256 value) private {
        if (value >= config.position) {
            uint256 increase = value - config.position;
            totalDeployed += increase;
            protocolExposure[config.protocol] += increase;
            assetExposure[config.asset] += increase;
        } else {
            uint256 decrease = config.position - value;
            totalDeployed -= decrease;
            protocolExposure[config.protocol] -= decrease;
            assetExposure[config.asset] -= decrease;
        }
        config.position = value;
    }

    function _setStrategyValuation(
        StrategyConfig storage config,
        uint256 value,
        uint256 shares,
        uint256 fees,
        address source
    ) private {
        _setStrategyValue(config, value);
        config.shares = shares;
        config.feesAccrued = fees;
        config.lastValuationBlock = block.number;
        config.valuationSource = source;
        config.valuationStatus = ValuationStatus.Current;
    }

    function _emitExposureChanges(StrategyConfig storage config) private {
        emit ProtocolExposureChanged(config.protocol, protocolExposure[config.protocol], protocolCaps[config.protocol].absoluteCap, protocolCaps[config.protocol].relativeCapBps);
        emit AssetExposureChanged(config.asset, assetExposure[config.asset], assetCaps[config.asset].absoluteCap, assetCaps[config.asset].relativeCapBps);
    }

    function _isValuationCurrent(StrategyConfig storage config) private view returns (bool) {
        return valuationFreshnessBlocks != 0
            && config.valuationStatus == ValuationStatus.Current
            && block.number <= config.lastValuationBlock + valuationFreshnessBlocks;
    }

    function _immediatelyWithdrawableValue(uint256 userValue, uint256 liquid, uint256 totalAssets)
        private
        view
        returns (uint256)
    {
        uint256 low;
        uint256 high = userValue < liquid ? userValue : liquid;
        while (low < high) {
            uint256 distance = high - low;
            uint256 amount = low + distance / 2 + distance % 2;
            uint256 requiredAfter = _requiredLiquidReserveAfter(amount, totalAssets);
            if (liquid - amount >= requiredAfter) low = amount;
            else high = amount - 1;
        }
        return low;
    }

    function _requiredLiquidReserveAfter(uint256 amount, uint256 totalAssets) private view returns (uint256) {
        uint256 liabilitiesAfter = totalAssets - amount;
        if (liabilitiesAfter == 0) return 0;
        uint256 reserveBps = _riskPolicy.minimumLiquidReserveBps;
        if (_bucketPolicy.liquidOperationalReserveBps > reserveBps) {
            reserveBps = _bucketPolicy.liquidOperationalReserveBps;
        }
        uint256 relativeReserveAfter = liabilitiesAfter * reserveBps / BPS;
        return relativeReserveAfter > _riskPolicy.minimumLiquidReserve
            ? relativeReserveAfter
            : _riskPolicy.minimumLiquidReserve;
    }

    function _recordOutflow(uint256 amount) private {
        if (maximumSingleWithdrawal != 0 && amount > maximumSingleWithdrawal) {
            revert WithdrawalLimitExceeded(amount, maximumSingleWithdrawal);
        }
        uint64 window = uint64(block.timestamp / 1 days);
        if (_outflowWindow != window) {
            _outflowWindow = window;
            _outflowSpent = 0;
        }
        uint256 available = dailyOutflowCap > _outflowSpent ? dailyOutflowCap - _outflowSpent : 0;
        if (dailyOutflowCap != 0 && amount > available) revert WithdrawalLimitExceeded(amount, available);
        _outflowSpent += amount;
    }

    function _emitStrategyAccounting(address strategy, StrategyConfig storage config) private {
        emit StrategyAccountingUpdated(
            strategy,
            config.principal,
            config.shares,
            config.position,
            config.realizedYield,
            config.realizedLoss,
            config.withdrawalShortfall,
            totalDeployed,
            config.lastValuationBlock,
            config.valuationStatus
        );
    }

    function _emitUserFinancialState(address user) private {
        UserFinancialState memory state = userFinancialState(user);
        emit UserFinancialStateChanged(
            user,
            state.principal,
            state.currentValue,
            state.unrealizedPnl,
            state.realizedPnl,
            state.totalPnl,
            state.immediatelyWithdrawableValue
        );
    }

    function _emitTreasuryNAV() private {
        emit TreasuryNAVChanged(totalManagedAssets(), totalUserLiabilities(), totalDeployed, liquidUSDC());
    }

    function scheduleRiskPolicy(uint256 minimumLiquidReserve, uint16 minimumLiquidReserveBps, uint256 maximumTotalDeployed)
        external
        whenNotPaused
        onlyRole(POLICY_ADMIN_ROLE)
        returns (bytes32 operationId)
    {
        if (minimumLiquidReserveBps > BPS) revert InvalidBasisPoints();
        RiskPolicy memory current = _riskPolicy;
        if (minimumLiquidReserve > current.minimumLiquidReserve || minimumLiquidReserveBps > current.minimumLiquidReserveBps || maximumTotalDeployed < current.maximumTotalDeployed) {
            revert InvalidPolicyChange();
        }
        if (minimumLiquidReserve == current.minimumLiquidReserve && minimumLiquidReserveBps == current.minimumLiquidReserveBps && maximumTotalDeployed == current.maximumTotalDeployed) {
            revert InvalidPolicyChange();
        }
        operationId = _schedule(PendingOperation({
            kind: OperationKind.RiskPolicy,
            eta: uint64(block.timestamp + TIMELOCK_DELAY),
            subject: address(0),
            secondary: bytes32(0),
            tertiary: address(0),
            value1: minimumLiquidReserve,
            value2: maximumTotalDeployed,
            bps: minimumLiquidReserveBps,
            bps2: 0,
            bps3: 0,
            bps4: 0
        }));
    }

    function executeRiskPolicy(bytes32 operationId) external whenNotPaused onlyRole(TIMELOCK_EXECUTOR_ROLE) {
        PendingOperation memory operation = pendingOperations[operationId];
        if (operation.eta == 0 || (operation.kind != OperationKind.RiskPolicy && operation.kind != OperationKind.WithdrawalPolicy)) {
            revert TimelockMissing(operationId);
        }
        if (block.timestamp < operation.eta) revert TimelockNotReady(operationId, operation.eta);
        delete pendingOperations[operationId];
        if (operation.kind == OperationKind.WithdrawalPolicy) {
            maximumSingleWithdrawal = operation.value1;
            dailyOutflowCap = operation.value2;
            emit WithdrawalPolicyChanged(operation.value1, operation.value2, msg.sender, false);
        } else {
            _riskPolicy = RiskPolicy({ minimumLiquidReserve: operation.value1, minimumLiquidReserveBps: operation.bps, maximumTotalDeployed: operation.value2 });
            emit RiskPolicyChanged(_riskPolicy, msg.sender, false);
        }
        emit TimelockExecuted(operationId, operation.kind);
    }

    function reduceRiskPolicy(uint256 minimumLiquidReserve, uint16 minimumLiquidReserveBps, uint256 maximumTotalDeployed)
        external
        onlyRole(POLICY_ADMIN_ROLE)
    {
        if (minimumLiquidReserveBps > BPS) revert InvalidBasisPoints();
        RiskPolicy memory current = _riskPolicy;
        if (minimumLiquidReserve < current.minimumLiquidReserve || minimumLiquidReserveBps < current.minimumLiquidReserveBps || maximumTotalDeployed > current.maximumTotalDeployed) revert InvalidPolicyChange();
        if (minimumLiquidReserve == current.minimumLiquidReserve && minimumLiquidReserveBps == current.minimumLiquidReserveBps && maximumTotalDeployed == current.maximumTotalDeployed) revert InvalidPolicyChange();
        _riskPolicy = RiskPolicy({ minimumLiquidReserve: minimumLiquidReserve, minimumLiquidReserveBps: minimumLiquidReserveBps, maximumTotalDeployed: maximumTotalDeployed });
        emit RiskPolicyChanged(_riskPolicy, msg.sender, true);
    }

    function setWithdrawalPolicy(uint256 newMaximumSingleWithdrawal, uint256 newDailyOutflowCap)
        external
        whenNotPaused
        onlyRole(POLICY_ADMIN_ROLE)
        returns (bytes32 operationId)
    {
        if (newMaximumSingleWithdrawal == maximumSingleWithdrawal && newDailyOutflowCap == dailyOutflowCap) revert InvalidPolicyChange();
        bool riskIncreasing = maximumSingleWithdrawal != 0
            && (newMaximumSingleWithdrawal == 0 || newMaximumSingleWithdrawal > maximumSingleWithdrawal)
            || dailyOutflowCap != 0 && (newDailyOutflowCap == 0 || newDailyOutflowCap > dailyOutflowCap);
        if (riskIncreasing) {
            operationId = _schedule(PendingOperation({
                kind: OperationKind.WithdrawalPolicy,
                eta: uint64(block.timestamp + TIMELOCK_DELAY),
                subject: address(0),
                secondary: bytes32(0),
                tertiary: address(0),
                value1: newMaximumSingleWithdrawal,
                value2: newDailyOutflowCap,
                bps: 0,
                bps2: 0,
                bps3: 0,
                bps4: 0
            }));
        } else {
            maximumSingleWithdrawal = newMaximumSingleWithdrawal;
            dailyOutflowCap = newDailyOutflowCap;
            emit WithdrawalPolicyChanged(newMaximumSingleWithdrawal, newDailyOutflowCap, msg.sender, true);
        }
    }

    function scheduleBucketPolicy(BucketPolicy calldata newPolicy)
        external
        whenNotPaused
        onlyRole(POLICY_ADMIN_ROLE)
        returns (bytes32 operationId)
    {
        _validateBucketPolicy(newPolicy);
        if (!_isRiskIncreasingBucketPolicy(newPolicy)) revert InvalidPolicyChange();
        operationId = _schedule(PendingOperation({
            kind: OperationKind.BucketPolicy,
            eta: uint64(block.timestamp + TIMELOCK_DELAY),
            subject: address(0),
            secondary: bytes32(0),
            tertiary: address(0),
            value1: 0,
            value2: 0,
            bps: newPolicy.liquidOperationalReserveBps,
            bps2: newPolicy.yieldStrategyBufferBps,
            bps3: newPolicy.sweepLiquidityBufferBps,
            bps4: newPolicy.automationAgentPoolBps
        }));
    }

    function executeBucketPolicy(bytes32 operationId) external whenNotPaused onlyRole(TIMELOCK_EXECUTOR_ROLE) {
        PendingOperation memory operation = _consume(operationId, OperationKind.BucketPolicy);
        _bucketPolicy = BucketPolicy({
            liquidOperationalReserveBps: operation.bps,
            yieldStrategyBufferBps: operation.bps2,
            sweepLiquidityBufferBps: operation.bps3,
            automationAgentPoolBps: operation.bps4
        });
        emit BucketPolicyChanged(_bucketPolicy, msg.sender, false);
        emit TimelockExecuted(operationId, operation.kind);
    }

    function reduceBucketPolicy(BucketPolicy calldata newPolicy) external onlyRole(POLICY_ADMIN_ROLE) {
        _validateBucketPolicy(newPolicy);
        if (_isRiskIncreasingBucketPolicy(newPolicy) || _isSameBucketPolicy(newPolicy)) revert InvalidPolicyChange();
        _bucketPolicy = newPolicy;
        emit BucketPolicyChanged(_bucketPolicy, msg.sender, true);
    }

    function scheduleProtocolApproval(bytes32 protocol, uint256 absoluteCap, uint16 relativeCapBps)
        external
        whenNotPaused
        onlyRole(POLICY_ADMIN_ROLE)
        returns (bytes32 operationId)
    {
        if (protocol == bytes32(0)) revert InvalidAddress();
        if ((absoluteCap == 0 && relativeCapBps == 0) || relativeCapBps > BPS) revert InvalidCap();
        operationId = _schedule(PendingOperation({
            kind: OperationKind.ProtocolApproval,
            eta: uint64(block.timestamp + TIMELOCK_DELAY),
            subject: address(0),
            secondary: protocol,
            tertiary: address(0),
            value1: absoluteCap,
            value2: 0,
            bps: relativeCapBps,
            bps2: 0,
            bps3: 0,
            bps4: 0
        }));
    }

    function executeProtocolApproval(bytes32 operationId) external whenNotPaused onlyRole(TIMELOCK_EXECUTOR_ROLE) {
        PendingOperation memory operation = _consume(operationId, OperationKind.ProtocolApproval);
        bytes32 protocolId = operation.secondary;
        if (!protocolCaps[protocolId].approved) approvedProtocolCount += 1;
        protocolCaps[protocolId] = ExposureCap(operation.value1, operation.bps, true, true);
        emit ProtocolApprovalChanged(protocolId, true, true);
        emit TimelockExecuted(operationId, operation.kind);
    }

    function scheduleAssetApproval(address asset, uint256 absoluteCap, uint16 relativeCapBps)
        external
        whenNotPaused
        onlyRole(POLICY_ADMIN_ROLE)
        returns (bytes32 operationId)
    {
        _validateCap(asset, absoluteCap, relativeCapBps);
        operationId = _schedule(PendingOperation({
            kind: OperationKind.AssetApproval,
            eta: uint64(block.timestamp + TIMELOCK_DELAY),
            subject: asset,
            secondary: bytes32(0),
            tertiary: address(0),
            value1: absoluteCap,
            value2: 0,
            bps: relativeCapBps,
            bps2: 0,
            bps3: 0,
            bps4: 0
        }));
    }

    function executeAssetApproval(bytes32 operationId) external whenNotPaused onlyRole(TIMELOCK_EXECUTOR_ROLE) {
        PendingOperation memory operation = _consume(operationId, OperationKind.AssetApproval);
        if (!assetCaps[operation.subject].approved) approvedAssetCount += 1;
        assetCaps[operation.subject] = ExposureCap(operation.value1, operation.bps, true, true);
        emit AssetApprovalChanged(operation.subject, true, true);
        emit TimelockExecuted(operationId, operation.kind);
    }

    function scheduleStrategyApproval(address strategy, bytes32 protocol, address asset, uint256 absoluteCap, uint16 relativeCapBps)
        external
        whenNotPaused
        onlyRole(POLICY_ADMIN_ROLE)
        returns (bytes32 operationId)
    {
        if (strategy == address(0) || protocol == bytes32(0) || asset == address(0) || strategy.code.length == 0) revert InvalidAddress();
        _assertStrategyInactiveForApproval(strategy);
        _validateCap(strategy, absoluteCap, relativeCapBps);
        operationId = _schedule(PendingOperation({
            kind: OperationKind.StrategyApproval,
            eta: uint64(block.timestamp + TIMELOCK_DELAY),
            subject: strategy,
            secondary: protocol,
            tertiary: asset,
            value1: absoluteCap,
            value2: 0,
            bps: relativeCapBps,
            bps2: 0,
            bps3: 0,
            bps4: 0
        }));
    }

    function executeStrategyApproval(bytes32 operationId) external whenNotPaused onlyRole(TIMELOCK_EXECUTOR_ROLE) {
        PendingOperation memory operation = _consume(operationId, OperationKind.StrategyApproval);
        bytes32 protocolId = operation.secondary;
        _assertStrategyInactiveForApproval(operation.subject);
        if (!protocolCaps[protocolId].approved || !protocolCaps[protocolId].enabled) revert NotApproved();
        if (!assetCaps[operation.tertiary].approved || !assetCaps[operation.tertiary].enabled) revert NotApproved();
        if (operation.tertiary != address(usdc)) revert StrategyMismatch();
        if (
            IVeloxStrategyAdapter(operation.subject).protocol() != protocolId
                || IVeloxStrategyAdapter(operation.subject).asset() != operation.tertiary
                || IVeloxStrategyAdapter(operation.subject).vault() != protocolVaults[protocolId]
        ) revert StrategyMismatch();
        if (!strategies[operation.subject].approved) approvedStrategyCount += 1;
        strategies[operation.subject] = StrategyConfig({
            protocol: protocolId,
            asset: operation.tertiary,
            absoluteCap: operation.value1,
            relativeCapBps: operation.bps,
            principal: 0,
            shares: 0,
            position: 0,
            realizedYield: 0,
            realizedLoss: 0,
            feesAccrued: 0,
            withdrawalShortfall: 0,
            lastValuationBlock: block.number,
            valuationSource: operation.subject,
            valuationStatus: ValuationStatus.Current,
            approved: true,
            enabled: true
        });
        emit StrategyApprovalChanged(operation.subject, protocolId, operation.tertiary, true, true);
        emit TimelockExecuted(operationId, operation.kind);
    }

    function cancelTimelock(bytes32 operationId) external onlyRole(POLICY_ADMIN_ROLE) {
        PendingOperation memory operation = pendingOperations[operationId];
        if (operation.eta == 0) revert TimelockMissing(operationId);
        delete pendingOperations[operationId];
        emit TimelockCancelled(operationId, operation.kind);
    }

    function disableProtocol(bytes32 protocol) external onlyRole(POLICY_ADMIN_ROLE) {
        protocolCaps[protocol].enabled = false;
        emit ProtocolApprovalChanged(protocol, protocolCaps[protocol].approved, false);
    }

    function disableAsset(address asset) external onlyRole(POLICY_ADMIN_ROLE) {
        assetCaps[asset].enabled = false;
        emit AssetApprovalChanged(asset, assetCaps[asset].approved, false);
    }

    function disableStrategy(address strategy) external onlyRole(POLICY_ADMIN_ROLE) {
        strategies[strategy].enabled = false;
        emit StrategyApprovalChanged(strategy, strategies[strategy].protocol, strategies[strategy].asset, strategies[strategy].approved, false);
    }

    function reduceProtocolCap(bytes32 protocol, uint256 absoluteCap, uint16 relativeCapBps) external onlyRole(POLICY_ADMIN_ROLE) {
        ExposureCap storage current = protocolCaps[protocol];
        if (protocol == bytes32(0)) revert InvalidAddress();
        _validateCapReduction(current.approved, current.absoluteCap, current.relativeCapBps, absoluteCap, relativeCapBps);
        current.absoluteCap = absoluteCap;
        current.relativeCapBps = relativeCapBps;
        emit ProtocolApprovalChanged(protocol, true, current.enabled);
    }

    function reduceAssetCap(address asset, uint256 absoluteCap, uint16 relativeCapBps) external onlyRole(POLICY_ADMIN_ROLE) {
        ExposureCap storage current = assetCaps[asset];
        _validateCap(asset, absoluteCap, relativeCapBps);
        _validateCapReduction(current.approved, current.absoluteCap, current.relativeCapBps, absoluteCap, relativeCapBps);
        current.absoluteCap = absoluteCap;
        current.relativeCapBps = relativeCapBps;
        emit AssetApprovalChanged(asset, true, current.enabled);
    }

    function reduceStrategyCap(address strategy, uint256 absoluteCap, uint16 relativeCapBps) external onlyRole(POLICY_ADMIN_ROLE) {
        StrategyConfig storage current = strategies[strategy];
        _validateCap(strategy, absoluteCap, relativeCapBps);
        _validateCapReduction(current.approved, current.absoluteCap, current.relativeCapBps, absoluteCap, relativeCapBps);
        current.absoluteCap = absoluteCap;
        current.relativeCapBps = relativeCapBps;
        emit StrategyApprovalChanged(strategy, current.protocol, current.asset, true, current.enabled);
    }

    function _validateCapReduction(bool approved, uint256 currentAbsoluteCap, uint16 currentRelativeCapBps, uint256 absoluteCap, uint16 relativeCapBps) private pure {
        if (!approved || absoluteCap > currentAbsoluteCap || relativeCapBps > currentRelativeCapBps) revert InvalidPolicyChange();
        if (absoluteCap == currentAbsoluteCap && relativeCapBps == currentRelativeCapBps) revert InvalidPolicyChange();
    }

    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
        emit EmergencyPause(msg.sender);
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _assertStrategyInactiveForApproval(address strategy) private view {
        StrategyConfig storage existing = strategies[strategy];
        uint256 currentValue = IVeloxStrategyAdapter(strategy).currentValue();
        if (existing.shares != 0 || existing.position != 0 || currentValue != 0) revert ActiveStrategy();
    }

    function _assertStrategyIdentity(address strategy, bytes32 protocol, address asset) private view {
        if (!protocolCaps[protocol].approved || !assetCaps[asset].approved) revert NotApproved();
        if (asset != address(usdc)) revert StrategyMismatch();
        if (
            IVeloxStrategyAdapter(strategy).protocol() != protocol
                || IVeloxStrategyAdapter(strategy).asset() != asset
                || IVeloxStrategyAdapter(strategy).vault() != protocolVaults[protocol]
        ) revert StrategyMismatch();
    }

    function _checkAllocation(StrategyConfig memory config, uint256 amount) private view {
        uint256 projectedStrategy = config.position + amount;
        uint256 projectedProtocol = protocolExposure[config.protocol] + amount;
        uint256 projectedAsset = assetExposure[config.asset] + amount;
        uint256 projectedAssets = totalManagedAssets();
        uint256 allowedStrategyValue = projectedAssets * _bucketPolicy.yieldStrategyBufferBps / BPS;
        if (projectedStrategy > allowedStrategyValue) revert YieldStrategyBufferExceeded(projectedStrategy, allowedStrategyValue);
        _enforceCap(address(this), projectedStrategy, config.absoluteCap, config.relativeCapBps, projectedAssets);
        ExposureCap memory protocol = protocolCaps[config.protocol];
        ExposureCap memory asset = assetCaps[config.asset];
        _enforceCap(config.protocol, projectedProtocol, protocol.absoluteCap, protocol.relativeCapBps, projectedAssets);
        _enforceCap(config.asset, projectedAsset, asset.absoluteCap, asset.relativeCapBps, projectedAssets);
    }

    function _enforceCap(bytes32 subject, uint256 exposure, uint256 absoluteCap, uint16 relativeCapBps, uint256 assets) private pure {
        _enforceCap(address(uint160(uint256(subject))), exposure, absoluteCap, relativeCapBps, assets);
    }

    function _enforceCap(address subject, uint256 exposure, uint256 absoluteCap, uint16 relativeCapBps, uint256 assets) private pure {
        uint256 allowed = absoluteCap;
        if (relativeCapBps > BPS) revert InvalidBasisPoints();
        if (relativeCapBps != 0) {
            uint256 relativeAllowed = assets * relativeCapBps / BPS;
            if (allowed == 0 || relativeAllowed < allowed) allowed = relativeAllowed;
        }
        if (allowed == 0 || exposure > allowed) revert ExposureCapExceeded(subject, exposure, allowed);
    }

    function _validateCap(address subject, uint256 absoluteCap, uint16 relativeCapBps) private pure {
        if (subject == address(0) || absoluteCap == 0 && relativeCapBps == 0 || relativeCapBps > BPS) revert InvalidCap();
    }

    function _schedule(PendingOperation memory operation) private returns (bytes32 operationId) {
        operationId = keccak256(abi.encode(address(this), _operationNonce++, operation.kind, operation.subject, operation.secondary, operation.tertiary, operation.value1, operation.value2, operation.bps, operation.bps2, operation.bps3, operation.bps4));
        if (pendingOperations[operationId].eta != 0) revert TimelockAlreadyExists(operationId);
        pendingOperations[operationId] = operation;
        emit TimelockScheduled(operationId, operation.kind, operation.eta);
    }

    function _validateBucketPolicy(BucketPolicy memory policy) private pure {
        if (
            policy.liquidOperationalReserveBps > BPS
                || policy.yieldStrategyBufferBps > BPS
                || policy.sweepLiquidityBufferBps > BPS
                || policy.automationAgentPoolBps > BPS
        ) revert InvalidBasisPoints();
        uint256 total = uint256(policy.liquidOperationalReserveBps)
            + policy.yieldStrategyBufferBps
            + policy.sweepLiquidityBufferBps
            + policy.automationAgentPoolBps;
        if (total != BPS) revert InvalidBucketAllocationTotal(total);
    }

    function _isRiskIncreasingBucketPolicy(BucketPolicy memory policy) private view returns (bool) {
        return policy.yieldStrategyBufferBps > _bucketPolicy.yieldStrategyBufferBps
            || policy.liquidOperationalReserveBps < _bucketPolicy.liquidOperationalReserveBps;
    }

    function _isSameBucketPolicy(BucketPolicy memory policy) private view returns (bool) {
        return policy.liquidOperationalReserveBps == _bucketPolicy.liquidOperationalReserveBps
            && policy.yieldStrategyBufferBps == _bucketPolicy.yieldStrategyBufferBps
            && policy.sweepLiquidityBufferBps == _bucketPolicy.sweepLiquidityBufferBps
            && policy.automationAgentPoolBps == _bucketPolicy.automationAgentPoolBps;
    }

    function _consume(bytes32 operationId, OperationKind expectedKind) private returns (PendingOperation memory operation) {
        operation = pendingOperations[operationId];
        if (operation.eta == 0 || operation.kind != expectedKind) revert TimelockMissing(operationId);
        if (block.timestamp < operation.eta) revert TimelockNotReady(operationId, operation.eta);
        delete pendingOperations[operationId];
    }
}
