import { useEffect, useState } from 'react';
import { isLoggedIn, getSession } from '../api';
import AuthScreen from './AuthScreen';
import App from '../App';
import type { SessionUser } from '../api';

// 顶层路由守卫：未登录展示登录/注册页；登录态过期（401）自动弹回。
export default function AuthGate() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [user, setUser] = useState<SessionUser | null>(getSession()?.user ?? null);

  useEffect(() => {
    const onUnauth = () => {
      setLoggedIn(false);
      setUser(null);
    };
    window.addEventListener('treechat:unauthorized', onUnauth);
    return () => window.removeEventListener('treechat:unauthorized', onUnauth);
  }, []);

  if (!loggedIn) {
    return <AuthScreen onAuth={() => setLoggedIn(true)} />;
  }
  return <App />;
}
