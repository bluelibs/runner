jest.mock("openai", () => {
  const responsesCreate = jest.fn(async () => {
    throw new Error(
      "Unexpected OpenAI API call in tests. Mock openAiClient.responses.create explicitly.",
    );
  });

  const OpenAI = jest.fn().mockImplementation(() => ({
    responses: {
      create: responsesCreate,
    },
  }));

  return {
    __esModule: true,
    default: OpenAI,
  };
});

afterEach(() => {
  jest.clearAllMocks();
});
