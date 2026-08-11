import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/auth';

export default function Nav() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  function handleSignOut() {
    signOut();
    router.push('/login');
  }

  return (
    <header className="nav">
      <Link href="/dashboard" className="nav-brand">
        Workflow Builder
      </Link>
      <div className="nav-right">
        {user ? (
          <>
            <span className="nav-user">{user.email}</span>
            <button className="btn btn-ghost" onClick={handleSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            <Link href="/signup">Sign up</Link>
          </>
        )}
      </div>
    </header>
  );
}
