import { resolveSolanaAddress, resolveSolanaName } from '../sns.js'
import { loadEnv } from '../loadEnv.js'

loadEnv()

const input = process.argv[2]
if (!input) {
  console.error('Usage: node tools/test-sns.js <wallet-or-domain>')
  process.exit(1)
}

try {
  const wallet = await resolveSolanaAddress(input)
  const primary = await resolveSolanaName(wallet.toBase58())
  console.log({ input, wallet: wallet.toBase58(), primaryDomain: primary })
} catch (error) {
  console.error('SNS test failed:', error?.message || String(error))
  process.exit(1)
}
