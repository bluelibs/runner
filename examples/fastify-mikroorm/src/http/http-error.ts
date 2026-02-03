export class HTTPError extends Error {
  statusCode: number;
  details?: any;

  constructor(statusCode: number, message: string, details?: any) {
    super(message);
    this.name = "HTTPError";
    this.statusCode = statusCode;
    this.details = details;
  }
}
