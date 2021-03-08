import { IncomingMessage } from 'http';
import url from 'url';

export const getQueryParam = (request: IncomingMessage, paramName: string): string | null => {
  // Only valid for request obtained from http.Server.
  const { query } = url.parse(request.url as string);
  const urlSearchParams = new URLSearchParams(query as string);

  return urlSearchParams.get(paramName);
};
