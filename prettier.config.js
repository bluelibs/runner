module.exports = {
  trailingComma: "all",
  tabWidth: 2,
  singleQuote: false,
  endOfLine: "auto",
  ignoreList: [".github/**/*.md"],
  overrides: [
    {
      files: ["*.ts"],
      options: {
        parser: "babel-ts",
      },
    },
  ],
};
