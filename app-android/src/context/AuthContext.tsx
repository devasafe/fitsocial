import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  loginRequest,
  registerRequest,
  meRequest,
  type AppUser,
} from "../api/auth";

const TOKEN_KEY = "fitsocial.token";

interface AuthState {
  user: AppUser | null;
  token: string | null;
  loading: boolean; // carregando a sessão salva ao abrir o app
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, username?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restaura a sessão salva ao abrir o app.
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(TOKEN_KEY);
        if (saved) {
          const { user } = await meRequest(saved);
          setToken(saved);
          setUser(user);
        }
      } catch {
        await AsyncStorage.removeItem(TOKEN_KEY); // token inválido/expirado
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = useCallback(async (nextToken: string, nextUser: AppUser) => {
    await AsyncStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { token, user } = await loginRequest(email, password);
      await persist(token, user);
    },
    [persist]
  );

  const register = useCallback(
    async (name: string, email: string, password: string, username?: string) => {
      const { token, user } = await registerRequest(name, email, password, username);
      await persist(token, user);
    },
    [persist]
  );

  const logout = useCallback(async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // Re-busca o usuário no backend (ex.: após concluir o onboarding).
  const refreshUser = useCallback(async () => {
    if (!token) return;
    const { user } = await meRequest(token);
    setUser(user);
  }, [token]);

  return (
    <AuthContext.Provider
      value={{ user, token, loading, login, register, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
