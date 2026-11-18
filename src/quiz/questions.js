// Crypto quiz pools (single source of truth)
// Each item: { q: string, choices: [A,B,C,D], answerIndex: 0-3, tags?: string[] }
//
// This version expands the overall pool and intentionally rebalances source answer
// positions so diagnostics stay healthy even before runtime answer shuffling.

const EASY = [
  {
    "q": "What does BTC stand for?",
    "choices": [
      "Bitcoin",
      "Byte Token Coin",
      "BitCash",
      "Block Trade Credit"
    ],
    "answerIndex": 0,
    "tags": [
      "bitcoin",
      "basics"
    ]
  },
  {
    "q": "What is the smallest unit of Bitcoin?",
    "choices": [
      "Satoshi",
      "Gwei",
      "Finney",
      "Lambo"
    ],
    "answerIndex": 0,
    "tags": [
      "bitcoin",
      "basics"
    ]
  },
  {
    "q": "Which network is ETH native to?",
    "choices": [
      "Ethereum",
      "Solana",
      "Polygon",
      "Binance Smart Chain"
    ],
    "answerIndex": 0,
    "tags": [
      "ethereum",
      "basics"
    ]
  },
  {
    "q": "What does DeFi stand for?",
    "choices": [
      "Decentralized Finance",
      "Default Finance",
      "Defined Fidelity",
      "Defer Income"
    ],
    "answerIndex": 0,
    "tags": [
      "defi",
      "basics"
    ]
  },
  {
    "q": "What is a blockchain?",
    "choices": [
      "A database of linked blocks",
      "A type of wallet",
      "A social network",
      "A mining machine"
    ],
    "answerIndex": 0,
    "tags": [
      "basics"
    ]
  },
  {
    "q": "Which of these is a crypto wallet?",
    "choices": [
      "MetaMask",
      "Photoshop",
      "Dropbox",
      "Steam"
    ],
    "answerIndex": 0,
    "tags": [
      "wallets",
      "basics"
    ]
  },
  {
    "q": "What is an NFT?",
    "choices": [
      "Non-Fungible Token",
      "New Finance Token",
      "Network Fee Ticket",
      "Node Function Tool"
    ],
    "answerIndex": 0,
    "tags": [
      "nft",
      "basics"
    ]
  },
  {
    "q": "Which consensus uses validators and staking?",
    "choices": [
      "Proof of Stake",
      "Proof of Work",
      "Proof of Space",
      "Proof of Burn"
    ],
    "answerIndex": 0,
    "tags": [
      "consensus",
      "basics"
    ]
  },
  {
    "q": "Which chain uses SOL as its token?",
    "choices": [
      "Solana",
      "Ethereum",
      "Cardano",
      "Ripple"
    ],
    "answerIndex": 0,
    "tags": [
      "solana",
      "basics"
    ]
  },
  {
    "q": "Private keys should be kept…",
    "choices": [
      "Secret and secure",
      "In public chat",
      "On a billboard",
      "Shared with friends"
    ],
    "answerIndex": 0,
    "tags": [
      "security",
      "wallets"
    ]
  },
  {
    "q": "Which is a layer-2 scaling solution for Ethereum?",
    "choices": [
      "Litecoin",
      "Polygon",
      "Monero",
      "Dogecoin"
    ],
    "answerIndex": 1,
    "tags": [
      "layer2",
      "ethereum"
    ]
  },
  {
    "q": "What is a gas fee?",
    "choices": [
      "Car fuel cost",
      "Transaction processing cost",
      "Exchange listing fee",
      "Wallet signup fee"
    ],
    "answerIndex": 1,
    "tags": [
      "ethereum",
      "fees"
    ]
  },
  {
    "q": "Stablecoins aim to track…",
    "choices": [
      "Gold only",
      "A stable value (e.g., USD)",
      "Random assets",
      "ETH price"
    ],
    "answerIndex": 1,
    "tags": [
      "stablecoins",
      "basics"
    ]
  },
  {
    "q": "Which is a hardware wallet brand?",
    "choices": [
      "Sledge",
      "Ledger",
      "Edge",
      "Badger"
    ],
    "answerIndex": 1,
    "tags": [
      "wallets",
      "security"
    ]
  },
  {
    "q": "What is a seed phrase?",
    "choices": [
      "A promo code",
      "A recovery phrase",
      "A DAO vote",
      "A chart pattern"
    ],
    "answerIndex": 1,
    "tags": [
      "wallets",
      "security"
    ]
  },
  {
    "q": "HODL is slang for…",
    "choices": [
      "Selling quickly",
      "Holding long-term",
      "Borrowing crypto",
      "Paying gas"
    ],
    "answerIndex": 1,
    "tags": [
      "slang",
      "basics"
    ]
  },
  {
    "q": "Which of these is NOT a blockchain?",
    "choices": [
      "Ethereum",
      "FTP",
      "Solana",
      "XRP Ledger"
    ],
    "answerIndex": 1,
    "tags": [
      "basics"
    ]
  },
  {
    "q": "DEX stands for…",
    "choices": [
      "Dedicated Exchange",
      "Decentralized Exchange",
      "Direct Executor",
      "Data Export"
    ],
    "answerIndex": 1,
    "tags": [
      "defi",
      "basics"
    ]
  },
  {
    "q": "Which site commonly shows token charts?",
    "choices": [
      "Google Docs",
      "DexScreener",
      "Netflix",
      "Uber"
    ],
    "answerIndex": 1,
    "tags": [
      "trading",
      "tools"
    ]
  },
  {
    "q": "KYC often means…",
    "choices": [
      "Keep Your Crypto",
      "Know Your Customer",
      "Key Your Chain",
      "Kill Your Costs"
    ],
    "answerIndex": 1,
    "tags": [
      "exchanges",
      "basics"
    ]
  },
  {
    "q": "Which is a common way to lose crypto forever?",
    "choices": [
      "Writing down your seed phrase safely",
      "Using a hardware wallet",
      "Sending to the wrong address",
      "Enabling 2FA"
    ],
    "answerIndex": 2,
    "tags": [
      "security",
      "basics"
    ]
  },
  {
    "q": "A public address is used to…",
    "choices": [
      "Recover your wallet",
      "Reveal your seed phrase",
      "Receive crypto",
      "Reset gas fees"
    ],
    "answerIndex": 2,
    "tags": [
      "wallets",
      "basics"
    ]
  },
  {
    "q": "What does market cap roughly mean?",
    "choices": [
      "Daily trading fees",
      "Number of miners",
      "Total value of all coins in circulation",
      "How many wallets exist"
    ],
    "answerIndex": 2,
    "tags": [
      "markets",
      "basics"
    ]
  },
  {
    "q": "What is a CEX?",
    "choices": [
      "Crypto extra chain",
      "Cross-chain executor",
      "Centralized exchange",
      "Cold entry exit"
    ],
    "answerIndex": 2,
    "tags": [
      "exchanges",
      "basics"
    ]
  },
  {
    "q": "What is staking usually used for?",
    "choices": [
      "Deleting blocks",
      "Printing NFTs on paper",
      "Helping secure a PoS network",
      "Avoiding wallets"
    ],
    "answerIndex": 2,
    "tags": [
      "staking",
      "consensus"
    ]
  },
  {
    "q": "A rug pull is…",
    "choices": [
      "A normal price dip",
      "A wallet backup",
      "A scam where liquidity/fees are abused and investors are left holding",
      "A validator upgrade"
    ],
    "answerIndex": 2,
    "tags": [
      "security",
      "scams"
    ]
  },
  {
    "q": "What is a bridge in crypto?",
    "choices": [
      "A social group",
      "A wallet password",
      "A way to move assets/messages between chains",
      "A mining pool"
    ],
    "answerIndex": 2,
    "tags": [
      "bridges",
      "basics"
    ]
  },
  {
    "q": "Which is safest to share publicly?",
    "choices": [
      "Seed phrase",
      "Private key",
      "Public wallet address",
      "2FA backup codes"
    ],
    "answerIndex": 2,
    "tags": [
      "security",
      "wallets"
    ]
  },
  {
    "q": "What does DYOR mean?",
    "choices": [
      "Deploy Your Own Router",
      "Do Your Order Right",
      "Do Your Own Research",
      "Double Your On-chain Results"
    ],
    "answerIndex": 2,
    "tags": [
      "slang",
      "basics"
    ]
  },
  {
    "q": "A cold wallet is…",
    "choices": [
      "A wallet for stablecoins only",
      "A wallet that only buys BTC",
      "A wallet stored offline",
      "A wallet inside an exchange"
    ],
    "answerIndex": 2,
    "tags": [
      "wallets",
      "security"
    ]
  },
  {
    "q": "What does mainnet mean in crypto?",
    "choices": [
      "A private test server",
      "A Discord role list",
      "A cold wallet backup",
      "The live network with real value"
    ],
    "answerIndex": 3,
    "tags": [
      "basics",
      "network"
    ]
  },
  {
    "q": "Why do blockchains charge transaction fees?",
    "choices": [
      "To reveal seed phrases",
      "To lower token supply instantly",
      "To create usernames",
      "To prevent spam and pay for processing"
    ],
    "answerIndex": 3,
    "tags": [
      "fees",
      "basics"
    ]
  },
  {
    "q": "What is a wallet app mainly used for?",
    "choices": [
      "Mining proof-of-work blocks on any phone",
      "Guaranteeing profits",
      "Replacing blockchain explorers",
      "Managing keys and signing transactions"
    ],
    "answerIndex": 3,
    "tags": [
      "wallets",
      "basics"
    ]
  },
  {
    "q": "On Solana, SOL is commonly used to pay for…",
    "choices": [
      "Stock dividends",
      "Only NFT images",
      "Discord boosts",
      "Gas and account-related costs"
    ],
    "answerIndex": 3,
    "tags": [
      "solana",
      "fees"
    ]
  },
  {
    "q": "Why should you verify a token mint or contract address before buying?",
    "choices": [
      "To make the chart green",
      "To skip confirmations",
      "To increase staking rewards",
      "To avoid fake or copycat tokens"
    ],
    "answerIndex": 3,
    "tags": [
      "security",
      "tokens"
    ]
  },
  {
    "q": "What does it mean when a transaction is confirmed?",
    "choices": [
      "It permanently cannot fail under any circumstance",
      "The wallet seed phrase was exported",
      "A moderator approved it manually",
      "It was included and recognized by the network"
    ],
    "answerIndex": 3,
    "tags": [
      "transactions",
      "basics"
    ]
  },
  {
    "q": "What is two-factor authentication (2FA)?",
    "choices": [
      "A backup blockchain",
      "A token burn event",
      "A charting pattern",
      "A second layer of login protection"
    ],
    "answerIndex": 3,
    "tags": [
      "security",
      "accounts"
    ]
  },
  {
    "q": "A block explorer is useful for…",
    "choices": [
      "Creating seed phrases",
      "Changing token decimals",
      "Editing smart contracts from chat",
      "Viewing on-chain transactions and addresses"
    ],
    "answerIndex": 3,
    "tags": [
      "tools",
      "basics"
    ]
  },
  {
    "q": "Why do projects pin official announcements and links?",
    "choices": [
      "To make gas fees lower",
      "To prevent wallets from connecting",
      "To delete old blocks",
      "To reduce confusion and phishing risk"
    ],
    "answerIndex": 3,
    "tags": [
      "community",
      "security"
    ]
  },
  {
    "q": "What is one smart habit before approving a wallet signature request?",
    "choices": [
      "Approve first and ask later",
      "Share the request in public with your seed phrase",
      "Disable your antivirus",
      "Read what the message or transaction is asking you to approve"
    ],
    "answerIndex": 3,
    "tags": [
      "security",
      "wallets"
    ]
  }
];

const MEDIUM = [
  {
    "q": "Which token standard is most common for Ethereum NFTs?",
    "choices": [
      "ERC-721",
      "ERC-20",
      "ERC-777",
      "BEP-2"
    ],
    "answerIndex": 0,
    "tags": [
      "ethereum",
      "nft"
    ]
  },
  {
    "q": "On Solana, an RPC node primarily provides…",
    "choices": [
      "Access to blockchain state and transaction submission",
      "GPU mining power",
      "NFT minting only",
      "Wallet custody"
    ],
    "answerIndex": 0,
    "tags": [
      "solana",
      "infrastructure"
    ]
  },
  {
    "q": "In AMMs like Uniswap, liquidity providers deposit…",
    "choices": [
      "Pairs/two assets into a pool",
      "Only one token",
      "Hardware wallets",
      "Private keys"
    ],
    "answerIndex": 0,
    "tags": [
      "defi",
      "amm"
    ]
  },
  {
    "q": "Slippage is the…",
    "choices": [
      "Difference between expected and executed price",
      "Gas rebate",
      "Exchange maker fee",
      "Block time"
    ],
    "answerIndex": 0,
    "tags": [
      "trading",
      "defi"
    ]
  },
  {
    "q": "A multisig wallet requires…",
    "choices": [
      "Multiple approvals to authorize a transaction",
      "No signatures",
      "SMS codes",
      "A bank account"
    ],
    "answerIndex": 0,
    "tags": [
      "security",
      "wallets"
    ]
  },
  {
    "q": "Stablecoin over-collateralization means…",
    "choices": [
      "Backed by more collateral than issued value",
      "Backed by less than liabilities",
      "Unbacked",
      "Backed only by NFTs"
    ],
    "answerIndex": 0,
    "tags": [
      "stablecoins",
      "defi"
    ]
  },
  {
    "q": "ERC-1155 is useful because it…",
    "choices": [
      "Supports both fungible and non-fungible tokens in one contract",
      "Is proof-of-work",
      "Eliminates gas",
      "Requires KYC"
    ],
    "answerIndex": 0,
    "tags": [
      "ethereum",
      "nft"
    ]
  },
  {
    "q": "The primary purpose of a blockchain indexer is to…",
    "choices": [
      "Provide fast query access to on-chain data",
      "Create keys",
      "Set gas price",
      "Stake tokens"
    ],
    "answerIndex": 0,
    "tags": [
      "infrastructure"
    ]
  },
  {
    "q": "Optimistic rollups assume…",
    "choices": [
      "Transactions are valid unless challenged",
      "All transactions are invalid",
      "No fraud can occur",
      "Proof-of-work miners exist on L2"
    ],
    "answerIndex": 0,
    "tags": [
      "layer2",
      "ethereum"
    ]
  },
  {
    "q": "Impermanent loss affects…",
    "choices": [
      "Hardware wallets",
      "Liquidity providers when relative token prices move",
      "Validators only",
      "Centralized exchanges only"
    ],
    "answerIndex": 1,
    "tags": [
      "defi",
      "amm"
    ]
  },
  {
    "q": "Front-running is when…",
    "choices": [
      "Validators refuse blocks",
      "A party reorders transactions to gain advantage",
      "Wallets rotate keys",
      "Bridges sync headers"
    ],
    "answerIndex": 1,
    "tags": [
      "mev",
      "trading"
    ]
  },
  {
    "q": "Gas limit on a transaction defines…",
    "choices": [
      "Maximum ether paid",
      "Maximum units of work the tx can consume",
      "Block size",
      "Nonce value"
    ],
    "answerIndex": 1,
    "tags": [
      "ethereum",
      "fees"
    ]
  },
  {
    "q": "A mnemonic seed phrase typically follows…",
    "choices": [
      "SMTP standards",
      "BIP-39 wordlists and derivation paths",
      "JPEG EXIF specs",
      "TLS cipher suites"
    ],
    "answerIndex": 1,
    "tags": [
      "wallets",
      "security"
    ]
  },
  {
    "q": "Proof of Stake validators are selected to propose blocks typically based on…",
    "choices": [
      "Random TikTok votes",
      "Stake and randomness",
      "Hashrate only",
      "Number of NFTs"
    ],
    "answerIndex": 1,
    "tags": [
      "consensus",
      "staking"
    ]
  },
  {
    "q": "Bridges between chains usually carry…",
    "choices": [
      "Private keys",
      "Messages/asset representations with verification",
      "DNS zones",
      "CPU firmware"
    ],
    "answerIndex": 1,
    "tags": [
      "bridges",
      "security"
    ]
  },
  {
    "q": "In Bitcoin, a UTXO is…",
    "choices": [
      "A wallet password",
      "An unspent transaction output",
      "A mining pool",
      "A token standard"
    ],
    "answerIndex": 1,
    "tags": [
      "bitcoin",
      "utxo"
    ]
  },
  {
    "q": "A nonce in account-based chains is primarily used to…",
    "choices": [
      "Set trading fees",
      "Prevent replay and enforce ordering",
      "Mint NFTs",
      "Increase block size"
    ],
    "answerIndex": 1,
    "tags": [
      "ethereum",
      "security"
    ]
  },
  {
    "q": "A flash loan is…",
    "choices": [
      "A bank wire",
      "A loan repaid within the same transaction",
      "A stablecoin mint",
      "A hardware wallet feature"
    ],
    "answerIndex": 1,
    "tags": [
      "defi"
    ]
  },
  {
    "q": "EIP-1559 introduced…",
    "choices": [
      "Free transactions",
      "Proof of Work for Ethereum",
      "A base fee that is burned plus optional tip",
      "NFT royalties"
    ],
    "answerIndex": 2,
    "tags": [
      "ethereum",
      "fees"
    ]
  },
  {
    "q": "A Merkle tree is mainly used to…",
    "choices": [
      "Encrypt private keys",
      "Increase block time",
      "Commit to lots of data with efficient proofs",
      "Replace wallets"
    ],
    "answerIndex": 2,
    "tags": [
      "cryptography",
      "basics"
    ]
  },
  {
    "q": "In a typical AMM pool, the price is determined by…",
    "choices": [
      "A central admin",
      "Only the largest trader",
      "A deterministic formula (e.g., x*y=k)",
      "A random oracle"
    ],
    "answerIndex": 2,
    "tags": [
      "defi",
      "amm"
    ]
  },
  {
    "q": "What is TVL in DeFi?",
    "choices": [
      "Token Value Limit",
      "Trade Volume Ledger",
      "Total Value Locked",
      "Tiered Validator List"
    ],
    "answerIndex": 2,
    "tags": [
      "defi",
      "metrics"
    ]
  },
  {
    "q": "A common risk of bridges is…",
    "choices": [
      "They always reduce fees",
      "They guarantee privacy",
      "They introduce extra trust/verification complexity",
      "They prevent hacks"
    ],
    "answerIndex": 2,
    "tags": [
      "bridges",
      "security"
    ]
  },
  {
    "q": "A smart contract is best described as…",
    "choices": [
      "A legal document",
      "A centralized API",
      "Code that runs on-chain according to rules",
      "A private key file"
    ],
    "answerIndex": 2,
    "tags": [
      "smart-contracts",
      "basics"
    ]
  },
  {
    "q": "What does self-custody mean?",
    "choices": [
      "An exchange holds your keys",
      "A bank secures your wallet",
      "You control your private keys",
      "A miner stores your seed phrase"
    ],
    "answerIndex": 2,
    "tags": [
      "wallets",
      "security"
    ]
  },
  {
    "q": "On Solana, a Token Account holds…",
    "choices": [
      "The private key for all wallets",
      "Only validator votes",
      "An individual owner balance for a specific mint",
      "Only NFT metadata"
    ],
    "answerIndex": 2,
    "tags": [
      "solana",
      "tokens"
    ]
  },
  {
    "q": "An Associated Token Account is best described as…",
    "choices": [
      "A random exchange deposit address",
      "A Discord-linked role field",
      "The default token account derived for an owner and mint",
      "A compressed seed phrase"
    ],
    "answerIndex": 2,
    "tags": [
      "solana",
      "tokens"
    ]
  },
  {
    "q": "A Program Derived Address (PDA) on Solana is…",
    "choices": [
      "A human-readable wallet domain",
      "A validator hardware device",
      "A centralized database row",
      "A deterministic address derived from program inputs"
    ],
    "answerIndex": 3,
    "tags": [
      "solana",
      "pda"
    ]
  },
  {
    "q": "In Solana transactions, the first signature is commonly treated as…",
    "choices": [
      "The mint authority",
      "A vote account",
      "A bridge receipt",
      "The transaction ID / signature used for lookup"
    ],
    "answerIndex": 3,
    "tags": [
      "solana",
      "transactions"
    ]
  },
  {
    "q": "Why do systems use unique redeem or payout IDs?",
    "choices": [
      "To increase market cap",
      "To reduce wallet security",
      "To bypass cooldowns",
      "To track, audit, and prevent duplicate settlement actions"
    ],
    "answerIndex": 3,
    "tags": [
      "payments",
      "backend"
    ]
  },
  {
    "q": "What does a dry-run payout mode help with?",
    "choices": [
      "Minting test NFTs for every answer",
      "Skipping logs",
      "Deleting pending redeems",
      "Testing the settlement flow without sending real tokens"
    ],
    "answerIndex": 3,
    "tags": [
      "payments",
      "ops"
    ]
  },
  {
    "q": "When an RPC endpoint is slow or failing, users may see…",
    "choices": [
      "Automatic seed phrase rotation",
      "A permanent token burn",
      "Role hierarchy fixes",
      "Balance fetch delays and transaction submission problems"
    ],
    "answerIndex": 3,
    "tags": [
      "rpc",
      "infrastructure"
    ]
  },
  {
    "q": "A replay-safe signing flow usually includes…",
    "choices": [
      "A public seed phrase",
      "A forced browser restart",
      "A second Discord account",
      "A fresh challenge, nonce, or unique message"
    ],
    "answerIndex": 3,
    "tags": [
      "security",
      "signing"
    ]
  },
  {
    "q": "Why is it useful for `/redeemspending` to show failed items too?",
    "choices": [
      "Users earn extra points for failures",
      "It removes the need for logs",
      "It hides settlement history",
      "Admins can see what needs retry or manual review"
    ],
    "answerIndex": 3,
    "tags": [
      "quiz",
      "payments"
    ]
  },
  {
    "q": "What should `/cycleclose` normally create in a reward system?",
    "choices": [
      "A new Discord server",
      "An automatic token burn of user balances",
      "A replacement seed phrase",
      "A frozen snapshot and pending payout records for the closed cycle"
    ],
    "answerIndex": 3,
    "tags": [
      "quiz",
      "payments"
    ]
  }
];

const HARD = [
  {
    "q": "Bitcoin uses which elliptic curve for signatures?",
    "choices": [
      "secp256k1",
      "P-256",
      "ed25519",
      "Curve25519"
    ],
    "answerIndex": 0,
    "tags": [
      "bitcoin",
      "cryptography"
    ]
  },
  {
    "q": "The Byzantine Generals Problem highlights…",
    "choices": [
      "Consensus with untrusted parties",
      "UI design issues",
      "Hardware malfunctions",
      "Fiat inflation"
    ],
    "answerIndex": 0,
    "tags": [
      "consensus",
      "theory"
    ]
  },
  {
    "q": "Merkle proofs allow…",
    "choices": [
      "Efficient verification of data inclusion",
      "Private key recovery",
      "Faster GPU mining",
      "Wallet syncing only"
    ],
    "answerIndex": 0,
    "tags": [
      "cryptography"
    ]
  },
  {
    "q": "MEV (Maximal Extractable Value) often results from…",
    "choices": [
      "Transaction ordering/manipulation by searchers/block producers",
      "Random key loss",
      "DNS outages",
      "PoW difficulty retarget"
    ],
    "answerIndex": 0,
    "tags": [
      "mev",
      "ethereum"
    ]
  },
  {
    "q": "In Solana, Proof of History provides…",
    "choices": [
      "A cryptographic source of time ordering for events",
      "Encrypted storage",
      "Validator slashing",
      "Fee markets"
    ],
    "answerIndex": 0,
    "tags": [
      "solana",
      "consensus"
    ]
  },
  {
    "q": "EVM nonces primarily prevent…",
    "choices": [
      "Transaction replay and enforce ordering per account",
      "Large blocks",
      "Gas refunds",
      "Cross-chain swaps"
    ],
    "answerIndex": 0,
    "tags": [
      "ethereum",
      "security"
    ]
  },
  {
    "q": "Sharding’s main tradeoff is…",
    "choices": [
      "Scalability vs cross-shard communication complexity",
      "Worse UX only",
      "Free gas",
      "Better privacy by default"
    ],
    "answerIndex": 0,
    "tags": [
      "scaling",
      "theory"
    ]
  },
  {
    "q": "A zero-knowledge proof allows verification…",
    "choices": [
      "Without revealing the underlying witness/data",
      "Only with plaintext data",
      "Only on L1",
      "By social consensus only"
    ],
    "answerIndex": 0,
    "tags": [
      "zk",
      "cryptography"
    ]
  },
  {
    "q": "A light client verifies…",
    "choices": [
      "Headers/checkpoints plus Merkle proofs",
      "Every transaction fully",
      "Only UI skins",
      "Private keys"
    ],
    "answerIndex": 0,
    "tags": [
      "clients",
      "security"
    ]
  },
  {
    "q": "BLS signatures are attractive for aggregation because they…",
    "choices": [
      "Allow multiple signatures to combine into one",
      "Reduce seed sizes",
      "Increase gas costs",
      "Break consensus"
    ],
    "answerIndex": 0,
    "tags": [
      "cryptography",
      "consensus"
    ]
  },
  {
    "q": "An Ethereum receipt root commits to…",
    "choices": [
      "Uncle blocks",
      "Logs/outcomes of transactions in a block",
      "Validator set",
      "Peer IDs"
    ],
    "answerIndex": 1,
    "tags": [
      "ethereum"
    ]
  },
  {
    "q": "The birthday bound is relevant to…",
    "choices": [
      "ECDH speed",
      "Hash collision probabilities",
      "Gas estimation",
      "RPC latency"
    ],
    "answerIndex": 1,
    "tags": [
      "cryptography"
    ]
  },
  {
    "q": "State growth pressure can be mitigated by…",
    "choices": [
      "Longer mnemonics",
      "Rent/expiry, pruning, stateless clients",
      "More NFTs",
      "Fixed gas"
    ],
    "answerIndex": 1,
    "tags": [
      "scaling",
      "clients"
    ]
  },
  {
    "q": "Deterministic wallets derive many keys using…",
    "choices": [
      "Random screenshots",
      "KDFs over a seed (e.g., BIP-32/44)",
      "Manual lists",
      "CSV only"
    ],
    "answerIndex": 1,
    "tags": [
      "wallets",
      "cryptography"
    ]
  },
  {
    "q": "An L2 validity proof (ZK rollup) ensures…",
    "choices": [
      "Transactions look pretty",
      "State transitions are correct without re-execution on L1",
      "Gas always zero",
      "All data is private"
    ],
    "answerIndex": 1,
    "tags": [
      "zk",
      "layer2"
    ]
  },
  {
    "q": "Ethereum’s EIP-155 prevents…",
    "choices": [
      "Large contracts",
      "Chain ID replay across chains",
      "DEX trading",
      "Seed phrase reuse"
    ],
    "answerIndex": 1,
    "tags": [
      "ethereum",
      "security"
    ]
  },
  {
    "q": "Replay protection across forks commonly uses…",
    "choices": [
      "JPEG headers",
      "Different chain IDs or signing domains",
      "DNS TXT records",
      "CSS variables"
    ],
    "answerIndex": 1,
    "tags": [
      "security",
      "theory"
    ]
  },
  {
    "q": "Verkle trees aim to improve…",
    "choices": [
      "UI scaling",
      "State commitment proofs with smaller witnesses",
      "GPU mining",
      "Wallet UX only"
    ],
    "answerIndex": 1,
    "tags": [
      "cryptography",
      "clients"
    ]
  },
  {
    "q": "In UTXO models, a transaction input must…",
    "choices": [
      "Contain account nonces",
      "Reference and spend a previous unspent output",
      "Include storage slots",
      "Import ABIs"
    ],
    "answerIndex": 1,
    "tags": [
      "bitcoin",
      "utxo"
    ]
  },
  {
    "q": "Schnorr signatures (vs ECDSA) offer…",
    "choices": [
      "Worse aggregation",
      "Linear aggregation and simpler security proofs",
      "No malleability fix",
      "No batch verification"
    ],
    "answerIndex": 1,
    "tags": [
      "cryptography"
    ]
  },
  {
    "q": "A commitment scheme provides…",
    "choices": [
      "Key rotation",
      "Lower latency",
      "Binding and hiding properties for committed values",
      "Bigger blocks"
    ],
    "answerIndex": 2,
    "tags": [
      "cryptography"
    ]
  },
  {
    "q": "Data availability sampling (DAS) helps L2s by…",
    "choices": [
      "Eliminating proofs",
      "Reducing wordlists",
      "Letting nodes verify data is published without downloading all of it",
      "Speeding wallets"
    ],
    "answerIndex": 2,
    "tags": [
      "scaling",
      "layer2"
    ]
  },
  {
    "q": "In Ethereum, the base fee in EIP-1559 is…",
    "choices": [
      "Paid to validators as tips",
      "Sent to a DAO treasury",
      "Burned (destroyed) by the protocol",
      "Refunded to the sender"
    ],
    "answerIndex": 2,
    "tags": [
      "ethereum",
      "fees"
    ]
  },
  {
    "q": "MEV-Boost and PBS (Proposer/Builder Separation) aim to…",
    "choices": [
      "Eliminate blocks",
      "Make PoW faster",
      "Separate block building from proposing to reduce centralization risks",
      "Remove mempools entirely"
    ],
    "answerIndex": 2,
    "tags": [
      "mev",
      "ethereum"
    ]
  },
  {
    "q": "In account abstraction (e.g., ERC-4337 style), the goal is to…",
    "choices": [
      "Remove smart contracts",
      "Force KYC on-chain",
      "Make accounts programmable (gas sponsoring, batching, custom auth)",
      "Replace signatures with passwords"
    ],
    "answerIndex": 2,
    "tags": [
      "ethereum",
      "aa"
    ]
  },
  {
    "q": "A reorg (chain reorganization) happens when…",
    "choices": [
      "Wallets rotate keys",
      "Gas prices go down",
      "A different fork becomes canonical, replacing recent blocks",
      "NFT metadata changes"
    ],
    "answerIndex": 2,
    "tags": [
      "consensus",
      "basics"
    ]
  },
  {
    "q": "In zkSNARK systems, a trusted setup risk refers to…",
    "choices": [
      "Servers going offline",
      "High gas fees",
      "Toxic waste parameters enabling fake proofs if compromised",
      "RPC rate limits"
    ],
    "answerIndex": 2,
    "tags": [
      "zk",
      "security"
    ]
  },
  {
    "q": "A stateless client approach generally aims to…",
    "choices": [
      "Store more state everywhere",
      "Remove signatures",
      "Reduce the need to store full state by using proofs",
      "Increase block time"
    ],
    "answerIndex": 2,
    "tags": [
      "clients",
      "scaling"
    ]
  },
  {
    "q": "Fraud proofs are most associated with…",
    "choices": [
      "ZK rollups",
      "Stablecoins",
      "Optimistic rollups",
      "Hardware wallets"
    ],
    "answerIndex": 2,
    "tags": [
      "layer2"
    ]
  },
  {
    "q": "In Solana, a common source of performance is…",
    "choices": [
      "Very slow block times",
      "UTXO-only design",
      "Parallel transaction execution where possible",
      "No validators"
    ],
    "answerIndex": 2,
    "tags": [
      "solana",
      "performance"
    ]
  },
  {
    "q": "An idempotent settlement worker is important because it…",
    "choices": [
      "Forces every payout to fail once",
      "Removes the need for IDs",
      "Makes audit logs impossible",
      "Can retry safely without paying the same item twice"
    ],
    "answerIndex": 3,
    "tags": [
      "payments",
      "backend"
    ]
  },
  {
    "q": "When syncing Discord roles from wallet balances, a strong design uses…",
    "choices": [
      "Random role assignment",
      "Only client-side checks",
      "Manual spreadsheet edits in chat",
      "Deterministic tier rules plus explicit add/remove actions"
    ],
    "answerIndex": 3,
    "tags": [
      "discord",
      "backend"
    ]
  },
  {
    "q": "A dead-letter queue is useful when…",
    "choices": [
      "You want to hide all payout errors",
      "You need to store seed phrases",
      "You are changing token names",
      "Repeatedly failing jobs need visibility instead of infinite silent retries"
    ],
    "answerIndex": 3,
    "tags": [
      "backend",
      "systems"
    ]
  },
  {
    "q": "Why is file locking or serialized writes helpful for JSON-backed state?",
    "choices": [
      "It guarantees infinite scaling",
      "It changes wallet ownership",
      "It makes webhooks unnecessary",
      "It reduces the chance of corruption from concurrent writes"
    ],
    "answerIndex": 3,
    "tags": [
      "backend",
      "storage"
    ]
  },
  {
    "q": "In a payout pipeline, the best place to resolve a user wallet is usually…",
    "choices": [
      "From a random chat message",
      "From any old screenshot",
      "From a public meme channel",
      "From the shared verified identity source of truth"
    ],
    "answerIndex": 3,
    "tags": [
      "payments",
      "identity"
    ]
  },
  {
    "q": "A strong cycle-close flow should be…",
    "choices": [
      "Based on memory only",
      "Dependent on manual copy-paste for every user",
      "Unable to be audited later",
      "Atomic enough that totals, records, and announcements stay consistent"
    ],
    "answerIndex": 3,
    "tags": [
      "payments",
      "ops"
    ]
  },
  {
    "q": "Why do high-signal diagnostics matter at startup?",
    "choices": [
      "They replace monitoring forever",
      "They increase token price automatically",
      "They remove the need for tests",
      "They reveal skew, permission issues, and broken configuration before users hit them"
    ],
    "answerIndex": 3,
    "tags": [
      "ops",
      "diagnostics"
    ]
  },
  {
    "q": "What is a strong way to manage sponsor quiz content long-term?",
    "choices": [
      "Keep every answer at A or B",
      "Remove all tags",
      "Hide malformed entries",
      "Use validated pools with clear metadata and periodic balance checks"
    ],
    "answerIndex": 3,
    "tags": [
      "quiz",
      "content"
    ]
  },
  {
    "q": "When OAuth-linked identity and payout identity diverge, the safest response is to…",
    "choices": [
      "Guess which wallet is right",
      "Always pick the newest random address",
      "Disable verification entirely",
      "Use one canonical wallet source and log where it came from"
    ],
    "answerIndex": 3,
    "tags": [
      "identity",
      "security"
    ]
  },
  {
    "q": "A robust bot suite benefits from shared modules for config and identity because they…",
    "choices": [
      "Make every command slower",
      "Prevent slash commands from existing",
      "Hide diagnostics from admins",
      "Reduce drift between faucet, quiz, mole, and watchdog flows"
    ],
    "answerIndex": 3,
    "tags": [
      "architecture",
      "backend"
    ]
  }
];

function getPool(level) {
  switch ((level || 'easy').toLowerCase()) {
    case 'medium': return [...MEDIUM];
    case 'hard': return [...HARD];
    default: return [...EASY];
  }
}

function getAllQuestions() {
  return [...EASY, ...MEDIUM, ...HARD];
}

function validatePools({ throwOnError = false } = {}) {
  const problems = [];
  function check(arr, label) {
    arr.forEach((q, i) => {
      const okQ = typeof q.q === 'string' && q.q.trim().length > 0;
      const okChoices = Array.isArray(q.choices) && q.choices.length === 4 && q.choices.every(c => typeof c === 'string');
      const okIdx = Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex <= 3;
      if (!okQ || !okChoices || !okIdx) problems.push({ label, i, q });
    });
  }
  check(EASY, 'easy');
  check(MEDIUM, 'medium');
  check(HARD, 'hard');
  if (problems.length) {
    const msg = `Question pool validation found ${problems.length} issue(s).`;
    if (throwOnError) throw new Error(msg);
    console.warn('⚠️ ' + msg);
  }
  return problems;
}

module.exports = { EASY, MEDIUM, HARD, getPool, getAllQuestions, validatePools };
