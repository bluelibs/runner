export interface IErrorDefinition<
  TData extends DefaultErrorType = DefaultErrorType,
> {
  id: string;
  serialize?: (data: TData) => string;
  parse?: (data: string) => TData;
}

export type DefaultErrorType = {
  message: string;
};
