/**
 * 実ネットワークを使う通し確認だけの設定。**通常の `yarn test` では回さない。**
 * デスクトップ版の `#[ignore]` つきテスト（`cargo test -- --ignored`）と同じ扱い。
 *
 *   yarn test:live
 *
 * `jest-expo` のプリセットを使わない理由: あれは `global.fetch` をモックするので、
 * 本物の 5ch に当てられない。ここでは Node 本来の `fetch` を使う。
 */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/live/**/*.live.test.js'],
  moduleDirectories: ['node_modules', '<rootDir>/src'],
  transform: {
    '^.+.js$': ['babel-jest', { configFile: `${__dirname}/babel.config.js` }],
  },
}
