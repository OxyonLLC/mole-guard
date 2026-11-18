import 'dotenv/config';
import { checkSender } from '../xl1-arcade/sender.js';
import { getArcadeConfig } from '../xl1-arcade/config.js';

try {
  const config = getArcadeConfig();
  const result = await checkSender({
    file: process.env.XL1_SENDER_FILE,
    sdkModule: process.env.XL1_SDK_MODULE,
    expectedAddress: config.distributor,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
