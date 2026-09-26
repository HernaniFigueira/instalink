'use client';
import { createContext, useContext } from 'react';
export const WorkspaceContext = createContext<{ role?: string; agendaScope?: string }>({});
export const useWorkspace = () => useContext(WorkspaceContext);
