module.exports = {
  trailingComma: "all",
  tabWidth: 2,
  singleQuote: false,
  overrides: [
    {
      files: ["*.ts"],
      options: {
        parser: "babel-ts",
      },
    },
  ],
};
