import { useMemo } from 'react';
import { ApolloProvider } from '@apollo/client';
import { AuthProvider, useAuth } from '../lib/auth';
import { getApolloClient } from '../lib/apollo';
import Nav from '../components/Nav';
import '../styles/globals.css';

function Inner({ Component, pageProps }) {
  const auth = useAuth();
  const client = useMemo(() => getApolloClient(), [auth.session?.accessToken]);

  if (auth.loading) {
    return <div className="page-center">Loading…</div>;
  }

  return (
    <ApolloProvider client={client}>
      <Nav />
      <main className="container">
        <Component {...pageProps} />
      </main>
    </ApolloProvider>
  );
}

export default function App(props) {
  return (
    <AuthProvider>
      <Inner {...props} />
    </AuthProvider>
  );
}
