// Camada relacional GoDoutor — ponto de entrada único.
// Rotas e serviços importam daqui (nunca o `pg` direto).
export { persistenceMode, relationalDatabaseUrl, relationalActive, storageConfig } from './config';
export type { PersistenceMode } from './config';
export { getPool, withTransaction, closePool } from './pool';
export { loadAgendaSlice, slotsForDate, dayMap, listBookingsManage } from './agenda';
export type { AgendaSlice, ManageListParams, ManageListResult, SlotsOutcome, SlotsRejection } from './agenda';
export {
  runRelationalWrite, readBusinessSlice, loadBusinessSlice, writeBackSlice,
  relationalLeadsDoc, drainRelationalAutomations,
} from './slice';
export { relationalBookingsGET, relationalBookingsPOST, relationalBookingsPATCH, relationalHeader } from './booking-routes';
export { authorizePatientUpload, registerPatientFile, getPatientFileRecord, signPatientFile } from '../storage';
