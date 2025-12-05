module.exports = {
  trailingComma: "all",
  tabWidth: 2,
  singleQuote: false,
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
