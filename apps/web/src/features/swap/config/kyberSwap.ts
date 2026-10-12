import { isAddress, type Address } from 'viem';

import {
  ARC_MAINNET_CHAIN_ID,
  ARC_USDC_CONTRACT_ADDRESS,
  ARC_USDC_DECIMALS,
} from '../../../contracts/usdc';
import type { SwapToken } from '../types';

export const KYBERSWAP_CHAIN_ID = ARC_MAINNET_CHAIN_ID;
/** KyberSwap's verified Aggregator API v1 slug for Arc Mainnet (chain ID 5042). */
export const KYBERSWAP_CHAIN_SLUG = 'arc';
export const KYBERSWAP_API_URL = (import.meta.env.VITE_KYBERSWAP_API_URL ?? 'https://aggregator-api.kyberswap.com').replace(/\/$/, '');
/** Public client identifier; deployments may override this with VITE_KYBERSWAP_CLIENT_ID. */
export const KYBERSWAP_CLIENT_ID = import.meta.env.VITE_KYBERSWAP_CLIENT_ID ?? 'velox-treasury';

export const KYBERSWAP_USDC_TOKEN: SwapToken = {
  chainId: KYBERSWAP_CHAIN_ID,
  address: ARC_USDC_CONTRACT_ADDRESS,
  symbol: 'USDC',
  name: 'USDC',
  decimals: ARC_USDC_DECIMALS,
  logoUri: 'https://storage.googleapis.com/ks-setting-1d682dca/aad5bbeb-45f2-4c17-b6f2-dbfc1d0698d61789459424126.png',
};

export const KYBERSWAP_EURC_TOKEN: SwapToken = {
  chainId: KYBERSWAP_CHAIN_ID,
  address: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1' as Address,
  symbol: 'EURC',
  name: 'EURC',
  decimals: 6,
  logoUri: 'https://storage.googleapis.com/ks-setting-1d682dca/3cb13e14-b165-4305-a272-d4fa03ca58051789468881141.png',
};

/**
 * Exact entries returned by KyberSwap's official Token API on 2026-09-22:
 * https://token-api.kyberswap.com/api/v1/public/tokens?chainIds=5042&isWhitelisted=true
 * Each entry was explicitly marked `isVerified: true` and `isWhitelisted: true`.
 */
function verifiedArcToken(symbol: string, name: string, address: string, decimals: number, logoUri?: string): SwapToken {
  if (!isAddress(address)) throw new Error(`Invalid Arc token address configured for ${symbol}.`);
  return { chainId: KYBERSWAP_CHAIN_ID, symbol, name, address: address as Address, decimals, ...(logoUri ? { logoUri } : {}) };
}

const KYBERSWAP_VERIFIED_ARC_TOKENS: readonly SwapToken[] = [
  KYBERSWAP_USDC_TOKEN,
  KYBERSWAP_EURC_TOKEN,
  verifiedArcToken('cirBTC', 'Circle Wrapped Bitcoin', '0x171a4217b86a807a64eb94757db6849fb4bdbaa0', 8, 'https://storage.googleapis.com/ks-setting-1d682dca/0ec4d0f8-8eee-4c73-a496-9582ee163b4f1789469942218.png'),
  verifiedArcToken('ARGUS', 'Argus', '0xece5ca8bf9220718e5727754026757512212cb3c', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/40fa2d83-404f-41a0-bdaf-0d76a4929ff41789532423899.jpg'),
  verifiedArcToken('TOLLY', 'Tolly', '0xbc43ce8dec648ea298c4275559b81d6261c90b67', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/2c3fc4ac-ffc0-481d-8f22-6cbf03ca58051789532377125.jpg'),
  verifiedArcToken('PP', 'Peach People', '0xbf1fdc20fbe85c3a58e0124e242662a1952293f9', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/6f50fd91-71e7-4132-a62b-b55616a07dd51789974602514.jpg'),
  verifiedArcToken('LONG', 'LONG', '0x2164bb17a2d38c1b5170e987b2c0416df1efc752', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/2b139c52-f887-4e96-b351-82062e3cbaac1789532445302.jpg'),
  verifiedArcToken('LIFT', 'lift.fun', '0x44b453d355835ce1269fc11d3fa4161c0dcc0087', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/2eb15447-c447-4ae9-a81a-0c901c1463fc1789544461842.jpg'),
  verifiedArcToken('COOL', 'usdc is cool', '0xeb64987643db71c76b2a2be7e723decc995e5b37', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/8c248fa5-39cd-4da2-9854-86dcb2ffe9731789532401779.jpg'),
  verifiedArcToken('WETH', 'Wrapped Ether', '0x128cc466b61f542da60c70e3aa11c10e19b84edb', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/110bf608-a129-45da-b43e-005959936f781789469865285.png'),
  verifiedArcToken('MURMUR', 'MurMur', '0x8faae5592b9acc27a79fca745c6b872adf514a5d', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/88ef861a-0b98-4486-bda6-3a943a51fcf71789974596893.jpg'),
  verifiedArcToken('MALA', 'Malachite', '0x4f7dc89dc44ad08c20d9680d2ee9cfad69bfda55', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/73e47fb4-0c87-45c7-a7d0-649d08e3c5131789704863682.jpg'),
  verifiedArcToken('DUKE', 'The Duke of Arc', '0x41358defd0dedc90528b3f1835715e907b686e6a', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/6d05fda0-71c8-46ee-b74f-f0c1256188d81789704701735.jpg'),
  verifiedArcToken('BARC', 'Barc', '0x4753c45fb550fecaa143a47968659117e6ffc2ce', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/4b51189f-5276-4ec7-a837-f7e06a029c011789544318872.jpg'),
  verifiedArcToken('CRCL', 'Circle Internet Group • Arc Token', '0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/247b9047-7b4b-4d49-a76b-222cca81da221789554277062.jpg'),
  verifiedArcToken('ARCT', 'ArcTools', '0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/2108398a-5d1b-405b-8b64-305f5cf93a991789554641612.jpg'),
  verifiedArcToken('Circled', 'Circled', '0x390128ca6d20661181ffde1259ced84de23fd4f5', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/63f18afe-9754-4756-9d23-fb05770b3ef81789704785566.jpg'),
  verifiedArcToken('Architects', 'Architects', '0x8bcb94279fc2c984ec34e0c1f2192df8c69ea4f0', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/a1b2d2c7-20e0-4d12-ab3a-4dd6845f29aa1789532351996.jpg'),
  verifiedArcToken('PI', '3.141592653589793238462643383279', '0x30ac39dec8a854c5fd03aa429e3bef32a7e4c84a', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/2d5ada6e-0a26-4c7e-8368-16484c331bce1789544202494.jpg'),
  verifiedArcToken('ARCAT', 'ARCAT', '0x07704b06981ea962b87296362a1281484d160000', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/5ba75f03-efe8-45c4-9201-87f8c1eddbc61789532270552.jpg'),
  verifiedArcToken('ARCBAT', 'ARC BAT', '0xbe0cad585ea2d13de2f4e36376be755c0afd8b97', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/289c8a31-41e8-4e5d-9a22-162ae902ccea1789704915597.jpg'),
  verifiedArcToken('ARCANINE', 'Arcanine', '0xf3715bf5c2de299f08b81180ffb739a8372a175f', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/0807a61f-9a1d-478f-a4d0-7bb0b5db0d551789554148959.jpg'),
  verifiedArcToken('MI', 'MI', '0x1e849f5960f02503939cbcbd44ab99b6dfcc4735', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/9354fb5e-d137-4070-a152-57490b8f66231789704881293.jpg'),
  verifiedArcToken('Minara', 'Minara', '0xa163d7624da3b5d9182c50eab5b8cd247ae861bb', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/c58a2bf7-6861-4ebe-963c-ca374bd3f22a1789554200539.jpg'),
  verifiedArcToken('BEANCAT', 'Bean Cat', '0x41c8a71f630c636294009fa4fb0cc4c3bbe674fe', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/e79560ce-622f-461d-829e-f5e267251f101789542912140.jpg'),
  verifiedArcToken('BANCOR', 'BANCOR', '0xc55a4468a3e1c2dfe58dddad0188c71d5dffd740', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/aca5dca0-5818-4a6e-892d-b79eef36f49d1789544250844.jpg'),
  verifiedArcToken('creo', 'creo.family', '0x1c98d896328c35a751ce18323f47139a44188001', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/b3083f2f-afa2-4644-b15a-3526b6128ab11789544270877.jpg'),
  verifiedArcToken('MDOG', 'MDOG', '0x83fd0bdddafa9a499582899d49515060c361b9aa', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/4401a2ea-4cb0-4ecc-a7c3-6c6683464bdc1789704824860.jpg'),
  verifiedArcToken('ACTOR', 'Economic Actor', '0xf4caa36a0b64d60dd1a909d502fae9b30dfca58b', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/96a6608e-0c43-4768-937f-09a1808731811789544227625.jpg'),
  verifiedArcToken('PEG', 'peg', '0xd626630dc244e50272017cc55a361d096c3a9062', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/5fe2158b-88ea-409e-9f18-f97d6c14cb231789542786207.jpg'),
  verifiedArcToken('AROS', 'Aros', '0xcdf59e06dcbc3a6ae662f66b35aaebd8decccb2c', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/387a2463-a329-492d-a165-06204246c46b1789542724138.jpg'),
  verifiedArcToken('豆', '豆', '0x802d3166ad677d3aa993c85910598885568099bf', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/178bd252-0085-4292-91d5-a6588582ab491789532321449.jpg'),
  verifiedArcToken('ARSE', 'Arse', '0xfb05aa6eca43a170ec6737721d1acdd14daea2a8', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/379ec16e-1b6c-4723-b204-2739e96cd4271789542704843.jpg'),
  verifiedArcToken('LAZY', "Arc's Chameleon", '0xd6509e6b2c2c3494bec027d81952e5079112adc6', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/172c6ccf-57f2-4529-bcd9-effa45afe2991789542768854.jpg'),
  verifiedArcToken('PCH', 'Peach', '0x7f2293b6df4934aa5392d5fef8ef9ca987b0393b', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/f1e26029-5019-4a98-b221-c577be2d83451789542491202.jpg'),
  verifiedArcToken('SQDLR', 'Squidlor', '0xaef4b506c532b217cf7b40fa22c508ac175ea761', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/72079fd5-fbad-4432-b9e5-53fd48e235cc1789704763409.jpg'),
  verifiedArcToken('ASPAD', 'ArcStockpad', '0x3dd6db0f20d747e1274839cdd6724cc5df1fb813', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/32c69224-2192-4afc-8d00-c6ffbc0de0991789704806729.jpg'),
  verifiedArcToken('ARCANIUM', 'Arcanium Launchpad', '0x00000000c752274cc0cd9c22fc0aac8ffadfda61', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/3e0cee37-ad72-4faa-92c6-6e376fa229a71789704742319.jpg'),
  verifiedArcToken('ARCASH', 'ARCASH', '0x0bffa97f774824e9da843699aedd2835cb1b8022', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/64899167-34e2-4562-b923-cbe34aaa881a1789544179763.jpg'),
  verifiedArcToken('XNAN', 'Nanite', '0x38dccd1fedd12f73737f6c1ee19b2d311e048909', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/f0b2c1f5-1042-40d8-b5bb-b1323e26b56f1789542750644.jpg'),
  verifiedArcToken('AKA', 'AKA', '0xc6cf5c8c17dec41e62bb72590925fb8a862b63c9', 18),
  verifiedArcToken('SCOUT', 'SCOUT', '0xce5c406fe1004cfbc3fb7a170d48f8335e3ea256', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/89226225-a867-4a1b-acdc-3c3d59eac8021789704898369.jpg'),
  verifiedArcToken('PANCHU', 'Pacharan', '0x648a5382bdcf286e7ff5122d01a983db314e620a', 18, 'https://storage.googleapis.com/ks-setting-1d682dca/3f3e4829-517c-486f-a964-abfb13bb8ccc1789704844367.jpg'),
];

function validateVerifiedArcTokenList(tokens: readonly SwapToken[]): readonly SwapToken[] {
  const seenAddresses = new Set<string>();
  for (const token of tokens) {
    const address = token.address.toLowerCase();
    if (token.chainId !== KYBERSWAP_CHAIN_ID || !isAddress(token.address) || seenAddresses.has(address)) {
      throw new Error('KyberSwap Arc token configuration is invalid.');
    }
    seenAddresses.add(address);
  }
  return tokens;
}

/** The static, address-deduplicated KyberSwap-verified token list for Arc Mainnet. */
export const KYBERSWAP_TOKEN_ALLOWLIST = validateVerifiedArcTokenList(KYBERSWAP_VERIFIED_ARC_TOKENS);

export function isKyberSwapTokenAllowed(address: string): boolean {
  return KYBERSWAP_TOKEN_ALLOWLIST.some((token) => token.address.toLowerCase() === address.toLowerCase());
}

export function isKyberSwapTokenSupported(token: SwapToken): boolean {
  return token.chainId === KYBERSWAP_CHAIN_ID && KYBERSWAP_TOKEN_ALLOWLIST.some((configuredToken) =>
    configuredToken.address.toLowerCase() === token.address.toLowerCase()
    && configuredToken.decimals === token.decimals,
  );
}
