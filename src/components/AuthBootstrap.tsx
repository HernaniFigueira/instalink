'use client';
import { useEffect } from 'react';
import { installFetchWrapper } from '@/lib/client-auth';

// Montado uma vez no layout raiz: garante que toda chamada /api/*
// leve o token de sessão (fallback para quando cookies estão bloqueados).
export function AuthBootstrap() {
  useEffect(() => {
    installFetchWrapper();
  }, []);
  return null;
}
