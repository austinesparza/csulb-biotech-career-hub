import './admin.css';
import './admin-polish.css';
import { OfficerShell } from './officer-shell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <OfficerShell>{children}</OfficerShell>;
}
