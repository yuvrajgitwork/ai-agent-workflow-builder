import { ApolloClient, InMemoryCache, HttpLink, split } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient as createWsClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';
import { GRAPHQL_URL, wsUrlFromGraphqlUrl } from './config';
import { getAccessToken } from './auth';

let apolloClient;

function buildClient() {
  const httpLink = new HttpLink({ uri: GRAPHQL_URL });

  const authLink = setContext((_, { headers }) => {
    const token = getAccessToken();
    return {
      headers: {
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
  });

  const wsLink =
    typeof window !== 'undefined'
      ? new GraphQLWsLink(
          createWsClient({
            url: wsUrlFromGraphqlUrl(GRAPHQL_URL),
            connectionParams: () => {
              const token = getAccessToken();
              return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
            },
          })
        )
      : null;

  const httpWithAuth = authLink.concat(httpLink);

  const splitLink =
    typeof window !== 'undefined' && wsLink
      ? split(
          ({ query }) => {
            const def = getMainDefinition(query);
            return def.kind === 'OperationDefinition' && def.operation === 'subscription';
          },
          wsLink,
          httpWithAuth
        )
      : httpWithAuth;

  return new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache(),
    defaultOptions: {
      watchQuery: { fetchPolicy: 'network-only' },
      query: { fetchPolicy: 'network-only' },
    },
  });
}

// Recreated on demand (e.g. after sign-in) so the WS link opens with a fresh token.
export function getApolloClient() {
  if (!apolloClient) apolloClient = buildClient();
  return apolloClient;
}

export function resetApolloClient() {
  apolloClient = buildClient();
  return apolloClient;
}
