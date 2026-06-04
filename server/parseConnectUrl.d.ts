export type ParsedConnectUrl = {
  serverUrl: string
  token?: string
  authToken?: string
}

export function parseConnectUrl(value: string): ParsedConnectUrl
