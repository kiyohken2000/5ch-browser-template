module.exports = {
  env: {
    browser: true,
    es6: true,
    jest: true,
  },
  parser: 'babel-eslint',
  // `prettier` は最後に置く。整形はすべて Prettier に任せ、ESLint は
  // 整形ではなく「間違い」だけを見る。
  // ボイラープレートは eslint-config-prettier を入れていながら extends に
  // 足しておらず、airbnb の semi / quotes / object-curly-newline が
  // Prettier の出力（semi: false / singleQuote）と毎行ぶつかっていた。
  extends: ['plugin:react/recommended', 'airbnb', 'prettier', 'prettier/react'],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly',
    __DEV__: 'readonly',
  },
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['react'],
  rules: {
    'react/jsx-filename-extension': 'off',
    'react/jsx-one-expression-per-line': 'off',
    'max-len': 'off',
    'react/prop-types': [1],
    'global-require': 'off',
    'no-console': 'off',
    'react/jsx-props-no-spreading': 'off',

    // --- ここから下は Ember の方針 ---

    // for...of を使う。パーサはバイト列を回すので、イテレータを畳むより
    // 素直なループの方が読める（airbnb は既定で禁止している）。
    'no-restricted-syntax': 'off',
    'no-continue': 'off',

    // FNV-1a ハッシュ（lib/idcolor.js）に XOR とシフトが要る。
    'no-bitwise': 'off',

    // 関数宣言は巻き上がるので、定義順で縛らない。
    // 変数も外す理由は `const styles = StyleSheet.create(...)` を
    // ファイル末尾に置く RN の慣習で、コンポーネントより後に来るため。
    'no-use-before-define': ['error', { functions: false, classes: true, variables: false }],

    // 名前付き export だけのモジュール（lib/*）を既定 export に寄せない。
    // 1 モジュール 1 責務で複数の関数を出すので、名前付きの方が読める。
    'import/prefer-default-export': 'off',

    // トークン列は位置そのものが同一性なので、添字をキーにしてよい。
    'react/no-array-index-key': 'off',

    // 1 スレ内の逐次処理は意図的に直列にする（相手への負荷を抑える）。
    'no-await-in-loop': 'off',

    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: true,
      },
    ],
  },
  settings: {
    'import/resolver': {
      node: {
        paths: ['src'],
      },
    },
  },
}
