'use client';
import { createContext, useContext } from 'react';
export const WorkspaceContext = createContext<{ userId?: string; role?: string; agendaScope?: string }>({});
export const useWorkspace = () => useContext(WorkspaceContext);
