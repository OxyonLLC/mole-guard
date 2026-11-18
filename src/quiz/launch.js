const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

const projectRoot = path.resolve(__dirname, '..', '..')
const rootEnv = path.resolve(projectRoot, '.env')
const quizEnv = path.resolve(__dirname, '.env')

if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv, override: false })
}
if (fs.existsSync(quizEnv)) {
  dotenv.config({ path: quizEnv, override: false })
}

const target = path.resolve(__dirname, 'index.js')
if (!fs.existsSync(target)) {
  throw new Error('Quiz launcher could not find src/quiz/index.js')
}

require(target)
