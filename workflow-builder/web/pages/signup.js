import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/auth';
import { resetApolloClient } from '../lib/apollo';

export default function Signup() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { needsVerification } = await signUp(email, password);
      if (needsVerification) {
        setNotice(
          'Account created. Email verification is required by this project — see CHECKLIST.md to disable it for local testing, or check your inbox.'
        );
      } else {
        resetApolloClient();
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-narrow">
      <h1>Sign up</h1>
      <form onSubmit={handleSubmit}>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password (8+ chars)</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p>
        Note: after signing up, an org owner needs to add you to an organization via{' '}
        <code>org_members</code> (see CHECKLIST.md / scripts/seed.mjs) before you&apos;ll see any
        workflows.
      </p>
    </div>
  );
}
