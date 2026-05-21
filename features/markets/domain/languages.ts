export interface WebPresenceInput {
  defaultLocale: string;
  alternateLocales: string[];
  subfolderSuffix: string;
}

export function buildWebPresenceInput(
  defaultLocale: string,
  alternateLocales: string[],
  subfolderSuffix: string,
): WebPresenceInput {
  return { defaultLocale, alternateLocales, subfolderSuffix };
}

export const WEB_PRESENCE_CREATE_MUTATION = `
  mutation MarketWebPresenceCreate($marketId: ID!, $webPresence: MarketWebPresenceCreateInput!) {
    marketWebPresenceCreate(marketId: $marketId, webPresence: $webPresence) {
      market { id }
      userErrors { field message }
    }
  }
`;

export const WEB_PRESENCE_UPDATE_MUTATION = `
  mutation MarketWebPresenceUpdate($webPresenceId: ID!, $webPresence: MarketWebPresenceUpdateInput!) {
    marketWebPresenceUpdate(webPresenceId: $webPresenceId, webPresence: $webPresence) {
      market { id }
      userErrors { field message }
    }
  }
`;
