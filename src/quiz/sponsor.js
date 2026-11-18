// Sponsored Area question packs.
// Structure: map sponsorKey -> array of questions (q, choices[4], answerIndex, tags?).
// This version expands both pools and rebalances source answer positions.

const SPONSOR_POOLS = {
  "xyo": [
    {
      "q": "In XYO terminology, a Bound Witness is best described as…",
      "choices": [
        "A cryptographic handshake attesting co-presence",
        "A consensus algorithm",
        "A token swap",
        "A mining rig"
      ],
      "answerIndex": 0
    },
    {
      "q": "Which role in XYO is primarily responsible for collecting observations?",
      "choices": [
        "Witness",
        "Diviner",
        "Archivist",
        "Validator"
      ],
      "answerIndex": 0
    },
    {
      "q": "Which role in XYO answers questions by analyzing stored data?",
      "choices": [
        "Diviner",
        "Witness",
        "Bridge",
        "Indexer"
      ],
      "answerIndex": 0
    },
    {
      "q": "Which role stores data so it can be retrieved later in XYO?",
      "choices": [
        "Archivist",
        "Miner",
        "Sequencer",
        "Oracle"
      ],
      "answerIndex": 0
    },
    {
      "q": "Bridges in XYO mainly…",
      "choices": [
        "Relay data between witnesses and archivists/diviners",
        "Connect different L1 blockchains",
        "Stake tokens for governance",
        "Mint NFTs"
      ],
      "answerIndex": 0
    },
    {
      "q": "Oracles in blockchain ecosystems generally…",
      "choices": [
        "Provide external data to smart contracts",
        "Create NFTs",
        "Mine Proof-of-Work blocks",
        "Format QR codes"
      ],
      "answerIndex": 0
    },
    {
      "q": "Data provenance refers to…",
      "choices": [
        "A record of data origin and handling",
        "Exchange listing fees",
        "Gas price charts",
        "Wallet UI skins"
      ],
      "answerIndex": 0
    },
    {
      "q": "A cryptographic signature proves…",
      "choices": [
        "Control of a private key without revealing it",
        "That gas fees are paid",
        "Exchange volume",
        "Government approval"
      ],
      "answerIndex": 0
    },
    {
      "q": "Immutability in ledgers means…",
      "choices": [
        "History is append-only and tamper-evident",
        "Records can be arbitrarily edited",
        "No backups exist",
        "All data is encrypted by default"
      ],
      "answerIndex": 0
    },
    {
      "q": "In blockchain context, a Merkle tree is used to…",
      "choices": [
        "Prove inclusion of data efficiently",
        "Compress images",
        "Generate randomness",
        "Stake tokens"
      ],
      "answerIndex": 0
    },
    {
      "q": "A hardware wallet primarily helps by…",
      "choices": [
        "Keeping private keys off internet-connected devices",
        "Lowering gas fees",
        "Speeding up exchanges",
        "Earning staking rewards automatically"
      ],
      "answerIndex": 0
    },
    {
      "q": "API endpoints in web3 projects commonly use which transport?",
      "choices": [
        "HTTP(S) JSON-RPC/REST",
        "SMTP",
        "FTP",
        "Telnet"
      ],
      "answerIndex": 0
    },
    {
      "q": "Rate limiting on APIs mainly helps prevent…",
      "choices": [
        "Abuse and overload",
        "Faster responses",
        "Encryption",
        "Key rotations"
      ],
      "answerIndex": 0
    },
    {
      "q": "A deterministic wallet allows you to…",
      "choices": [
        "Always get the same keys from the same seed",
        "Change address format at random",
        "Avoid backups",
        "Skip signatures"
      ],
      "answerIndex": 0
    },
    {
      "q": "The principle of least privilege means…",
      "choices": [
        "Grant minimal required permissions",
        "Grant admin to everyone",
        "Disable auth",
        "Post secrets publicly"
      ],
      "answerIndex": 0
    },
    {
      "q": "Developer docs (like docs.xyo.network) are mainly used to…",
      "choices": [
        "Store private keys",
        "Explain APIs/SDKs and how to integrate",
        "Mine new blocks",
        "Host memes only"
      ],
      "answerIndex": 1
    },
    {
      "q": "An SDK is best described as…",
      "choices": [
        "A random token",
        "Developer tools/libraries to integrate a system",
        "A wallet seed phrase",
        "A gas refund"
      ],
      "answerIndex": 1
    },
    {
      "q": "Good API docs usually include…",
      "choices": [
        "Only marketing",
        "Endpoints, parameters, examples, and auth details",
        "Private keys",
        "User passwords"
      ],
      "answerIndex": 1
    },
    {
      "q": "A common safe way to store API keys in apps is…",
      "choices": [
        "Hardcode into frontend JS",
        "Use environment variables or a secrets manager",
        "Commit to GitHub",
        "Post in Discord"
      ],
      "answerIndex": 1
    },
    {
      "q": "When an API changes without breaking clients, it's usually because of…",
      "choices": [
        "No versioning",
        "Versioning and backwards-compatibility practices",
        "Deleting docs",
        "Disabling HTTPS"
      ],
      "answerIndex": 1
    },
    {
      "q": "XYO describes itself as what kind of network at ecosystem scale?",
      "choices": [
        "A centralized exchange",
        "A decentralized data and DePIN network",
        "A browser game only",
        "A fiat payment rail"
      ],
      "answerIndex": 1
    },
    {
      "q": "Which token is described by XYO as the security, staking, and governance side of the dual-token model?",
      "choices": [
        "XL1",
        "XYO",
        "USDC",
        "ETH"
      ],
      "answerIndex": 1
    },
    {
      "q": "Which token is described by XYO as the utility and gas token for Layer One?",
      "choices": [
        "BTC",
        "XL1",
        "XYO",
        "COIN"
      ],
      "answerIndex": 1
    },
    {
      "q": "XYO Layer One is intended to handle what especially well?",
      "choices": [
        "Only image hosting",
        "Real-world data at scale",
        "Only private emails",
        "Only meme coins"
      ],
      "answerIndex": 1
    },
    {
      "q": "Payload Elevation in XYO Layer One is described as a way to…",
      "choices": [
        "Reduce wallet seed phrases",
        "Bring validated data into shared consensus",
        "Disable validators",
        "Replace APIs"
      ],
      "answerIndex": 1
    },
    {
      "q": "Lookback Windows in XYO Layer One mainly reduce…",
      "choices": [
        "Wallet addresses",
        "Storage and computation requirements",
        "Discord usernames",
        "Token names"
      ],
      "answerIndex": 1
    },
    {
      "q": "According to XYO docs, which node type produces blocks?",
      "choices": [
        "Witness Nodes",
        "Block Producer Nodes",
        "Archivists",
        "Relays"
      ],
      "answerIndex": 1
    },
    {
      "q": "Which node type validates blocks in XYO Layer One?",
      "choices": [
        "Block Producer Nodes",
        "Validator Nodes",
        "Efficiency Nodes",
        "Witness Nodes"
      ],
      "answerIndex": 1
    },
    {
      "q": "Which XYO node type focuses on optimization and network efficiency?",
      "choices": [
        "Seed Nodes",
        "Efficiency Nodes",
        "Explorer Nodes",
        "Quiz Nodes"
      ],
      "answerIndex": 1
    },
    {
      "q": "The XL1 Wallet is described by XYO as what?",
      "choices": [
        "A mining ASIC",
        "A browser extension wallet for XYO Layer One",
        "A Discord plugin",
        "A bridge to Bitcoin only"
      ],
      "answerIndex": 1
    },
    {
      "q": "In XYO docs, what does XL1 pay for on-chain?",
      "choices": [
        "Seed phrase backups",
        "Discord boosts",
        "Gas fees and utility activity",
        "Email storage"
      ],
      "answerIndex": 2
    },
    {
      "q": "Step Rewards in XYO are designed to reward…",
      "choices": [
        "Only Discord mods",
        "Only miners",
        "Validators, producers, and passive stakers at milestones",
        "Only websites"
      ],
      "answerIndex": 2
    },
    {
      "q": "XYO says system staking lets holders earn what?",
      "choices": [
        "JPEGs",
        "Free gas forever",
        "XL1 rewards",
        "A second seed phrase"
      ],
      "answerIndex": 2
    },
    {
      "q": "In XYO docs, Bound Witnesses originally provided strong guarantees of…",
      "choices": [
        "Zero gas forever",
        "Private messaging",
        "Origin and integrity of data",
        "Centralized custody"
      ],
      "answerIndex": 2
    },
    {
      "q": "The 'chain of chains' idea in XYO refers to…",
      "choices": [
        "Buying multiple tokens",
        "Running several Discord bots",
        "Unifying independent proof chains into a shared state",
        "Posting across social apps"
      ],
      "answerIndex": 2
    },
    {
      "q": "Why does XYO emphasize data provenance?",
      "choices": [
        "To hide transactions",
        "To change gas fees",
        "To understand where data came from and how it was handled",
        "To replace signatures"
      ],
      "answerIndex": 2
    },
    {
      "q": "Which XYO app is mentioned as producing data from many nodes?",
      "choices": [
        "Photoshop",
        "MetaMask",
        "COIN App",
        "Telegram"
      ],
      "answerIndex": 2
    },
    {
      "q": "XYO presents itself as useful for which kinds of applications?",
      "choices": [
        "Only browser themes",
        "Only cloud gaming",
        "AI, real-world assets, and data-heavy apps",
        "Only email filters"
      ],
      "answerIndex": 2
    },
    {
      "q": "In XYO docs, what problem do Lookback Windows help with?",
      "choices": [
        "Seed phrase typos",
        "Discord outages",
        "Blockchain bloat",
        "Browser cookies"
      ],
      "answerIndex": 2
    },
    {
      "q": "According to XYO docs, what helps keep Layer One lightweight and fair?",
      "choices": [
        "Removing validation",
        "Hardcoding keys",
        "A fresh architecture using Payload Elevation and Lookback Windows",
        "Disabling blocks"
      ],
      "answerIndex": 2
    },
    {
      "q": "What does a block reward go to in XYO tokenomics?",
      "choices": [
        "Any Discord user",
        "Only websites",
        "A producer address for successful block creation",
        "Only archivists"
      ],
      "answerIndex": 2
    },
    {
      "q": "What does XYO call one of the major milestone payout systems?",
      "choices": [
        "Gasless Jackpot",
        "Bridge Bonus",
        "Step Reward Pool",
        "Witness Mint"
      ],
      "answerIndex": 2
    },
    {
      "q": "In the dual-token model, separating XYO and XL1 mainly helps by…",
      "choices": [
        "Making wallets longer",
        "Removing consensus",
        "Separating security/staking from utility/throughput",
        "Hiding tokenomics"
      ],
      "answerIndex": 2
    },
    {
      "q": "Why is an official docs site helpful in a quiz context?",
      "choices": [
        "It replaces all wallets",
        "It removes gas fees",
        "It gives users a place to verify facts they learn",
        "It creates NFTs automatically"
      ],
      "answerIndex": 2
    },
    {
      "q": "A good XYO-themed quiz question should emphasize…",
      "choices": [
        "Seed phrase guessing",
        "Unverified rumors",
        "Verifiable protocol and ecosystem concepts",
        "Private admin notes"
      ],
      "answerIndex": 2
    },
    {
      "q": "XYO Layer One describes itself as the first blockchain designed for what?",
      "choices": [
        "Payments only",
        "Gaming cosmetics",
        "Email",
        "Data"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "xl1",
        "basics"
      ]
    },
    {
      "q": "Bound Witness Trees in XYO are used to…",
      "choices": [
        "Replace validators with wallets",
        "Burn XL1",
        "Store Discord avatars",
        "Organize and compress verifiable data"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "architecture"
      ]
    },
    {
      "q": "Lookback Windows help nodes by letting them focus on…",
      "choices": [
        "Only Discord logs",
        "Only off-chain spreadsheets",
        "Seed phrase backups",
        "A recent segment of chain history instead of the entire chain"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "architecture"
      ]
    },
    {
      "q": "Which XYO node type can propose a rollback or replacement repair?",
      "choices": [
        "Witness Nodes",
        "Bridge Nodes",
        "Efficiency Nodes",
        "Validator Nodes"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "nodes"
      ]
    },
    {
      "q": "A participation transaction in XYO helps prove…",
      "choices": [
        "A wallet owns every token",
        "The docs site is offline",
        "A role was clicked manually",
        "A node actively performed work for rewards eligibility"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "rewards"
      ]
    },
    {
      "q": "Block rewards in XYO are split between the producer address and…",
      "choices": [
        "A Discord channel",
        "The wallet seed phrase",
        "An NFT image host",
        "The Step Reward Pool"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "rewards"
      ]
    },
    {
      "q": "Efficiency Nodes in XYO mainly exist to…",
      "choices": [
        "Replace all validators permanently",
        "Handle only social media posts",
        "Store private keys for users",
        "Improve speed and reduce congestion for the blockchain"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "nodes"
      ]
    },
    {
      "q": "Which type of work is XYO Layer One explicitly positioned to support well?",
      "choices": [
        "Only email filters",
        "Only password managers",
        "Only meme galleries",
        "Data-heavy applications"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "basics"
      ]
    },
    {
      "q": "According to XYO docs, Validator Nodes check blocks before what expires?",
      "choices": [
        "The wallet balance",
        "The app icon",
        "The chart interval",
        "The slashing window"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "nodes"
      ]
    },
    {
      "q": "What do Block Producer Nodes include in the blocks they create?",
      "choices": [
        "Only JPEG images",
        "Only Discord messages",
        "Only bridge addresses",
        "Hashes of included transactions and elevated payloads"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "blocks"
      ]
    },
    {
      "q": "What does data provenance help XYO users understand?",
      "choices": [
        "How to hide all inputs forever",
        "How to replace signatures with usernames",
        "How to stop block production",
        "Where data came from and how it was handled"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "data"
      ]
    },
    {
      "q": "What is one purpose of Step Rewards in XYO?",
      "choices": [
        "To remove all block rewards",
        "To turn XL1 into a stablecoin",
        "To make every node identical",
        "To incentivize sustained participation by producers, validators, and stakers"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "rewards"
      ]
    },
    {
      "q": "Which token in the XYO dual-token model is used for utility and gas on Layer One?",
      "choices": [
        "XYO",
        "COIN",
        "ETH",
        "XL1"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "xl1",
        "tokens"
      ]
    },
    {
      "q": "Which token in the XYO dual-token model is positioned around security, staking, and governance?",
      "choices": [
        "XL1",
        "USDC",
        "BTC",
        "XYO"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "tokens"
      ]
    },
    {
      "q": "Why do Lookback Windows matter for decentralization?",
      "choices": [
        "They force every node to keep more old data",
        "They remove proofs from the chain",
        "They disable participation transactions",
        "They help reduce hardware demands that grow with full-history requirements"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "architecture"
      ]
    },
    {
      "q": "In XYO, an Origin Chain is best described as…",
      "choices": [
        "A chronological chain of a device's Bound Witnesses",
        "A bridge between two separate blockchains",
        "A staking pool for Geotokens",
        "A mining-difficulty adjustment"
      ],
      "answerIndex": 0,
      "tags": [
        "xyo",
        "architecture"
      ]
    },
    {
      "q": "XY Find It, XYO's earliest consumer product, was best known for…",
      "choices": [
        "Running a decentralized exchange",
        "Bluetooth item-finding beacons",
        "Minting NFTs",
        "Hosting its own Layer-1 blockchain"
      ],
      "answerIndex": 1,
      "tags": [
        "xyo",
        "history"
      ]
    },
    {
      "q": "The COIN app rewards everyday users mainly for…",
      "choices": [
        "Providing liquidity on a DEX",
        "Operating validator nodes",
        "Collecting geospatial data through participation",
        "Auditing smart contracts"
      ],
      "answerIndex": 2,
      "tags": [
        "xyo",
        "products"
      ]
    },
    {
      "q": "In XYO World, Geotokens primarily represent…",
      "choices": [
        "Gas fees paid to miners",
        "Wrapped Bitcoin",
        "Governance-only voting shares",
        "Ownership of geographic areas"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "tokens"
      ]
    },
    {
      "q": "A central aim of the XYO network is to turn real-world observations into…",
      "choices": [
        "Verifiable evidence",
        "Advertising revenue",
        "Proof-of-work hashes",
        "A national currency"
      ],
      "answerIndex": 0,
      "tags": [
        "xyo",
        "concepts"
      ]
    },
    {
      "q": "XL1 is best described as…",
      "choices": [
        "A Bluetooth tracking beacon",
        "XYO's Layer-One chain for the proof-infrastructure era",
        "A centralized customer database",
        "A social media network"
      ],
      "answerIndex": 1,
      "tags": [
        "xyo",
        "xl1"
      ]
    },
    {
      "q": "In XYO, Sentinels are the components that…",
      "choices": [
        "Answer questions from stored data",
        "Store Bound Witnesses long-term",
        "Create observations from the real world",
        "Relay data between other nodes"
      ],
      "answerIndex": 2,
      "tags": [
        "xyo",
        "roles"
      ]
    },
    {
      "q": "Which of these best reflects XYO's more recent 'proof infrastructure' direction?",
      "choices": [
        "XY Find It beacons",
        "The original geomining COIN app",
        "SentinelX hardware finders",
        "XL1 with smart contracts and modern SDKs"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "xl1"
      ]
    },
    {
      "q": "In the modern XYO SDK, every 'payload' (its fundamental data unit) must include a…",
      "choices": [
        "schema field identifying its type",
        "private signing key",
        "USD price quote",
        "gas limit"
      ],
      "answerIndex": 0,
      "tags": [
        "xyo",
        "dev"
      ]
    },
    {
      "q": "SentinelX, in XYO's history, was a…",
      "choices": [
        "Stablecoin",
        "Hardware device used to contribute observations",
        "Governance DAO",
        "Block explorer"
      ],
      "answerIndex": 1,
      "tags": [
        "xyo",
        "history"
      ]
    },
    {
      "q": "XYO's 'Explore' product is, today, primarily focused on…",
      "choices": [
        "Bluetooth item tags",
        "Geomining rewards",
        "XL1",
        "Fiat on-ramps"
      ],
      "answerIndex": 2,
      "tags": [
        "xyo",
        "products"
      ]
    },
    {
      "q": "Why does XYO link Bound Witnesses together into Origin Chains?",
      "choices": [
        "To mine tokens faster",
        "To lower Bluetooth power use",
        "To push ads to nearby users",
        "To build a tamper-evident history of evidence"
      ],
      "answerIndex": 3,
      "tags": [
        "xyo",
        "concepts"
      ]
    }
  ],
  "winlew": [
    {
      "q": "WinLEW is best described as…",
      "choices": [
        "A community-driven crypto token/brand",
        "A photo editor",
        "A car model",
        "A messaging app"
      ],
      "answerIndex": 0
    },
    {
      "q": "A typical faucet in a crypto project exists to…",
      "choices": [
        "Distribute small test tokens for development/engagement",
        "Print fiat",
        "Replace private keys",
        "Raise gas fees"
      ],
      "answerIndex": 0
    },
    {
      "q": "Which is a common way to check token charts?",
      "choices": [
        "DexScreener",
        "Paint",
        "Slack",
        "Zoom"
      ],
      "answerIndex": 0
    },
    {
      "q": "A Discord bot helping with quizzes and faucets should never…",
      "choices": [
        "DM users asking for seed phrases",
        "Read commands",
        "Use env secrets securely",
        "Log basic events"
      ],
      "answerIndex": 0
    },
    {
      "q": "Strong community moderation helps…",
      "choices": [
        "Protect users and reduce spam",
        "Increase scams",
        "Disable bots",
        "Break indexing"
      ],
      "answerIndex": 0
    },
    {
      "q": "A fair quiz system should…",
      "choices": [
        "Reward fast, correct answers transparently",
        "Hide scoring rules",
        "Share answers early",
        "Favor admins"
      ],
      "answerIndex": 0
    },
    {
      "q": "Private keys should be stored…",
      "choices": [
        "Offline/secure where possible",
        "In source control",
        "In screenshots",
        "In public chat"
      ],
      "answerIndex": 0
    },
    {
      "q": "Environment variables (.env) are used to store…",
      "choices": [
        "Secrets like bot tokens",
        "Source PNGs",
        "Public images",
        "Memes"
      ],
      "answerIndex": 0
    },
    {
      "q": "A quiz cooldown exists to…",
      "choices": [
        "Limit abuse and prevent overlapping rounds",
        "Increase spam",
        "Delete points",
        "Hide leaderboards"
      ],
      "answerIndex": 0
    },
    {
      "q": "Ephemeral replies are helpful because…",
      "choices": [
        "They confirm actions without cluttering channels",
        "They spam chat",
        "They reveal private keys",
        "They auto-ban users"
      ],
      "answerIndex": 0
    },
    {
      "q": "A project website (like winlew.co) is commonly used to…",
      "choices": [
        "Publish info, tools, and community links",
        "Store seed phrases",
        "Mine blocks on a server",
        "Generate private keys for users"
      ],
      "answerIndex": 0
    },
    {
      "q": "A safe verification page should…",
      "choices": [
        "Minimize data collected and explain what it does",
        "Ask for seed phrases",
        "Require posting private keys",
        "Disable HTTPS"
      ],
      "answerIndex": 0
    },
    {
      "q": "A good anti-phishing rule is…",
      "choices": [
        "Verify domains carefully before connecting wallets",
        "Click every DM link",
        "Share your seed phrase to confirm",
        "Disable 2FA"
      ],
      "answerIndex": 0
    },
    {
      "q": "If a site offers downloads, the safest habit is to…",
      "choices": [
        "Prefer official domain and verify hashes/releases when possible",
        "Download from any mirror",
        "Trust random reposts",
        "Run everything as admin"
      ],
      "answerIndex": 0
    },
    {
      "q": "A Terms/Privacy page matters because it…",
      "choices": [
        "Makes scams easier",
        "Explains data usage and rules",
        "Replaces encryption",
        "Creates private keys"
      ],
      "answerIndex": 1
    },
    {
      "q": "The WinLEW utility bot is designed to combine which core modules?",
      "choices": [
        "Only email and maps",
        "Faucet, mole, quiz, and watchdog",
        "Only moderation and music",
        "Only video and images"
      ],
      "answerIndex": 1
    },
    {
      "q": "In the WinLEW flow, why is saving a wallet useful?",
      "choices": [
        "It replaces the wallet key",
        "It supports faucet claims and related utility flows",
        "It sends points automatically to exchanges",
        "It disables slash commands"
      ],
      "answerIndex": 1
    },
    {
      "q": "A good WinLEW quiz system should make answer order…",
      "choices": [
        "Always B",
        "Randomized to avoid predictable streaks",
        "Always the same",
        "Hidden"
      ],
      "answerIndex": 1
    },
    {
      "q": "Why should `!commands` include slash command visibility?",
      "choices": [
        "So slash commands are disabled",
        "So users can discover both prefix and slash workflows",
        "So roles get removed",
        "So only admins can play"
      ],
      "answerIndex": 1
    },
    {
      "q": "A production-ready WinLEW payout cycle should be…",
      "choices": [
        "Manual memory only",
        "Tracked, reviewable, and auditable",
        "Based on random guesses",
        "Hidden from admins"
      ],
      "answerIndex": 1
    },
    {
      "q": "In WinLEW quiz payouts, 1 point is intended to map to…",
      "choices": [
        "0 WinLEW always",
        "1 WinLEW at cycle settlement",
        "10 BTC",
        "A Discord role only"
      ],
      "answerIndex": 1
    },
    {
      "q": "Why should a faucet and role-link system share wallet identity correctly?",
      "choices": [
        "To hide user wallets",
        "To avoid making already-linked users re-register",
        "To randomize balances",
        "To slow down claims"
      ],
      "answerIndex": 1
    },
    {
      "q": "What is the benefit of a watchdog module in a bot suite?",
      "choices": [
        "Higher slippage",
        "Service visibility and heartbeat monitoring",
        "Seed export",
        "Mint creation"
      ],
      "answerIndex": 1
    },
    {
      "q": "What does a command parity pass help catch?",
      "choices": [
        "Only token burns",
        "Missing or rewritten commands after merges",
        "Only webhooks",
        "Only chart issues"
      ],
      "answerIndex": 1
    },
    {
      "q": "A good WinLEW bot help menu should be…",
      "choices": [
        "Empty",
        "Comprehensive but grouped for quick use",
        "Only for moderators",
        "A single random link"
      ],
      "answerIndex": 1
    },
    {
      "q": "Why do direct official links matter for WinLEW users?",
      "choices": [
        "They replace wallets",
        "They reduce friction and phishing confusion",
        "They change token supply",
        "They remove audits"
      ],
      "answerIndex": 1
    },
    {
      "q": "What is one reason to show `!rpc` in a utility bot?",
      "choices": [
        "To expose private keys",
        "To provide endpoint visibility for diagnostics",
        "To create NFTs",
        "To change Discord names"
      ],
      "answerIndex": 1
    },
    {
      "q": "A fair faucet status command should show…",
      "choices": [
        "Only memes",
        "Readiness, cooldown, and holder requirement context",
        "Only admin secrets",
        "Only user DMs"
      ],
      "answerIndex": 1
    },
    {
      "q": "In a merged WinLEW bot project, slash commands are especially helpful for…",
      "choices": [
        "Deleting JSON files",
        "Replacing wallets",
        "Discoverability and structured inputs",
        "Changing token decimals"
      ],
      "answerIndex": 2
    },
    {
      "q": "Why should payout records include an ID?",
      "choices": [
        "To make charts prettier",
        "To hide the user",
        "To allow approval, settlement, and auditing by reference",
        "To reduce total points"
      ],
      "answerIndex": 2
    },
    {
      "q": "What is the safest way for a WinLEW bot to handle secrets?",
      "choices": [
        "Commit them to Git",
        "Paste them into chat",
        "Keep them outside source and load from env",
        "Store them in command names"
      ],
      "answerIndex": 2
    },
    {
      "q": "Why should the quiz pool be expanded over time?",
      "choices": [
        "To make answers easier to memorize",
        "To reduce participation",
        "To improve replay value and learning",
        "To remove sponsor content"
      ],
      "answerIndex": 2
    },
    {
      "q": "A utility bot becomes more market-ready when it has…",
      "choices": [
        "No logging",
        "Only one command",
        "Reliable UX, clear commands, and auditable flows",
        "Random payouts"
      ],
      "answerIndex": 2
    },
    {
      "q": "Why might WinLEW keep sponsor quizzes separate from general quizzes?",
      "choices": [
        "To hide points",
        "To disable leaderboards",
        "To support themed learning and campaign tracking",
        "To prevent cooldowns"
      ],
      "answerIndex": 2
    },
    {
      "q": "What should happen at the end of a payout cycle in WinLEW?",
      "choices": [
        "All scores should be deleted",
        "Wallets should unlink",
        "Points should translate into pending settlement records",
        "The faucet should burn supply"
      ],
      "answerIndex": 2
    },
    {
      "q": "A user-facing command alias like `!save` for `!register` helps by…",
      "choices": [
        "Increasing gas",
        "Hiding help text",
        "Reducing friction and matching natural wording",
        "Changing sponsor totals"
      ],
      "answerIndex": 2
    },
    {
      "q": "A strong WinLEW learning loop is…",
      "choices": [
        "Ask for seed phrases",
        "Disable leaderboards",
        "Play quiz, earn points, settle rewards, and learn more next round",
        "Repeat only one question"
      ],
      "answerIndex": 2
    },
    {
      "q": "Why is wallet verification valuable before rewards and roles?",
      "choices": [
        "It replaces moderation",
        "It eliminates RPC needs",
        "It ties utility to a confirmed wallet identity",
        "It hides balances"
      ],
      "answerIndex": 2
    },
    {
      "q": "A Discord bot that spans multiple modules benefits from…",
      "choices": [
        "One giant anonymous function only",
        "No health checks",
        "Clear boundaries plus shared identity and payout logic",
        "No persistence"
      ],
      "answerIndex": 2
    },
    {
      "q": "What makes a WinLEW command system easier to support long-term?",
      "choices": [
        "Frequent silent renames",
        "Removing aliases",
        "Consistency across old and new command surfaces",
        "Hiding navigation"
      ],
      "answerIndex": 2
    },
    {
      "q": "What should `/redeemspending` help an admin inspect?",
      "choices": [
        "Only welcome messages",
        "Only token logos",
        "Pending and failed redemption settlements",
        "Only role colors"
      ],
      "answerIndex": 2,
      "tags": [
        "winlew",
        "payments",
        "quiz"
      ]
    },
    {
      "q": "What is the main purpose of `/cycleclose`?",
      "choices": [
        "To wipe every leaderboard permanently",
        "To disconnect all wallets",
        "To close the active reward window and queue settlement records",
        "To disable sponsor quizzes"
      ],
      "answerIndex": 2,
      "tags": [
        "winlew",
        "payments",
        "quiz"
      ]
    },
    {
      "q": "A strong WinLEW payout route should write back what after settlement?",
      "choices": [
        "Only the channel name",
        "Only a meme reaction",
        "Nothing at all",
        "Amount, status, tx reference, and timestamp"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "payments"
      ]
    },
    {
      "q": "Why is a payout dry-run mode valuable in WinLEW?",
      "choices": [
        "It increases user balances automatically",
        "It removes audit logs",
        "It forces duplicate payouts",
        "It lets admins test queue behavior safely before live sends"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "payments",
        "ops"
      ]
    },
    {
      "q": "What is the benefit of showing estimated WinLEW due inside point views?",
      "choices": [
        "It reveals private keys",
        "It changes token supply",
        "It disables cycle close",
        "Users can understand how points translate into rewards"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "ux",
        "payments"
      ]
    },
    {
      "q": "Why should WinLEW keep wallet-link data consistent across modules?",
      "choices": [
        "So balances can become random",
        "So every bot can request registration again",
        "So RPC checks stop working",
        "So faucet, quiz, and role systems all recognize the same user identity"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "identity"
      ]
    },
    {
      "q": "A healthy WinLEW command surface should do what after merges?",
      "choices": [
        "Hide help text entirely",
        "Make old commands throw by default",
        "Rename everything every week",
        "Preserve aliases and discoverability instead of silently dropping commands"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "ux",
        "commands"
      ]
    },
    {
      "q": "What is one useful role of the watchdog module?",
      "choices": [
        "Minting random rewards",
        "Changing token decimals",
        "Signing wallet challenges",
        "Reporting service heartbeat and health status"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "watchdog"
      ]
    },
    {
      "q": "Why are structured logs valuable in a WinLEW bot suite?",
      "choices": [
        "They guarantee price growth",
        "They replace backups",
        "They eliminate permissions",
        "They make debugging cross-module issues much easier"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "ops"
      ]
    },
    {
      "q": "What does a command like `!rpc` help surface?",
      "choices": [
        "User seed phrases",
        "Wallet ownership changes",
        "Leaderboard resets",
        "Endpoint visibility for troubleshooting"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "diagnostics"
      ]
    },
    {
      "q": "What is one advantage of shared command inventory for help output?",
      "choices": [
        "It disables slash commands",
        "It hides admin actions",
        "It randomizes aliases",
        "It keeps `!help`, `!commands`, and navigation consistent"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "commands"
      ]
    },
    {
      "q": "Why should pending payout records have stable unique IDs?",
      "choices": [
        "So the records disappear faster",
        "So all balances round to zero",
        "So the quiz answers become easier",
        "So admins and workers can reference the exact record safely"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "payments",
        "backend"
      ]
    },
    {
      "q": "What should happen when a WinLEW payout worker cannot find a wallet?",
      "choices": [
        "It should guess a new wallet",
        "It should send to the bot wallet instead",
        "It should delete the user score",
        "It should record the failure state and retry or await review"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "payments",
        "identity"
      ]
    },
    {
      "q": "Why is answer-order randomization important in WinLEW quizzes?",
      "choices": [
        "It removes the need for correct answers",
        "It makes cooldowns shorter",
        "It changes point totals",
        "It prevents patterns like long A/B streaks from training users to guess"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "quiz",
        "ux"
      ]
    },
    {
      "q": "A market-ready WinLEW bot should combine what qualities?",
      "choices": [
        "No persistence, no logs, and hidden behavior",
        "Only one command and one quiz",
        "Random manual role assignment",
        "Reliable commands, clear UX, audited payouts, and good diagnostics"
      ],
      "answerIndex": 3,
      "tags": [
        "winlew",
        "ops",
        "ux"
      ]
    }
  ]
};

const SPONSOR_ALIASES = {
  'docs.xyo.network': 'xyo',
  'xyo.network': 'xyo',
  'www.xyo.network': 'xyo',
  'xyo': 'xyo',
  'winlew.co': 'winlew',
  'www.winlew.co': 'winlew',
  'winlew.com': 'winlew',
  'www.winlew.com': 'winlew',
  'winlew': 'winlew',
};

function normalizeSponsorKey(input) {
  if (!input) return '';
  let s = String(input).trim().toLowerCase();
  try {
    if (s.startsWith('http://') || s.startsWith('https://')) {
      const u = new URL(s);
      s = u.hostname.toLowerCase();
    }
  } catch {}
  s = s.split('?')[0].split('#')[0].replace(/\/$/, '');
  if (SPONSOR_ALIASES[s]) return SPONSOR_ALIASES[s];
  const hostish = s.split('/')[0];
  if (SPONSOR_ALIASES[hostish]) return SPONSOR_ALIASES[hostish];
  return hostish;
}

function getSponsorPool(sponsorKey) {
  const key = normalizeSponsorKey(sponsorKey);
  return SPONSOR_POOLS[key] || [];
}

function validateSponsorPools() {
  for (const [key, pool] of Object.entries(SPONSOR_POOLS)) {
    pool.forEach((q, idx) => {
      const okChoices = Array.isArray(q.choices) && q.choices.length === 4;
      const okIndex = Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex <= 3;
      if (!okChoices || !okIndex || typeof q.q !== 'string') {
        console.warn(`⚠️ Sponsor pool "${key}" bad question at #${idx}:`, { q: q.q, choices: q.choices, answerIndex: q.answerIndex });
      }
    });
  }
}

validateSponsorPools();

module.exports = { SPONSOR_POOLS, getSponsorPool, normalizeSponsorKey, SPONSOR_ALIASES };
