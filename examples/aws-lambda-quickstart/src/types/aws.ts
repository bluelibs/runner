// Minimal types to increase type-safety without adding deps

export type ApiGatewayV2HttpEvent = {
  // version is not always present in mocks; keep optional
  version?: "2.0";
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  pathParameters?: Record<string, string>;
};

export type ApiGatewayV1RestEvent = {
  httpMethod?: string;
  path?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  pathParameters?: Record<string, string>;
};

export type AnyApiGatewayEvent = ApiGatewayV2HttpEvent | ApiGatewayV1RestEvent;

export type LambdaContextLike = {
  awsRequestId?: string;
};
