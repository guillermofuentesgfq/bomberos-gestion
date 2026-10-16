/**
 * Punto de entrada del panel administrativo. `App.tsx` importa desde aquí.
 */

export { AdminLayout, ADMIN_SECTIONS, isSectionActive } from './AdminLayout';
export type { AdminLayoutProps, AdminLayoutUser, AdminSection } from './AdminLayout';
export { InventoryPage } from './InventoryPage';
export { PersonsPage, personDetailPath } from './PersonsPage';
export { PersonDetailPage } from './PersonDetailPage';
export { MovementsPage } from './MovementsPage';
export { ContentAdminPage } from './ContentAdminPage';
export { SettingsPage } from './SettingsPage';
