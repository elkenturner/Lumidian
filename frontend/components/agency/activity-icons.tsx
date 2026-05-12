import {
  StickyNote,
  UserPlus,
  RefreshCw,
  Send,
  Globe,
  Link2,
  Check,
  MessageSquare,
  XCircle,
  Circle,
  ListPlus,
  UserCircle,
  CheckCircle2,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const ICONS: Record<string, Icon> = {
  note: StickyNote,
  client_created: UserPlus,
  client_status_changed: RefreshCw,
  draft_sent_to_client: Send,
  draft_marked_posted: Globe,
  review_link_generated: Link2,
  review_link_rotated: Link2,
  client_approved: Check,
  client_changes_requested: MessageSquare,
  client_rejected: XCircle,
  task_created: ListPlus,
  task_assigned: UserCircle,
  task_completed: CheckCircle2,
};

export function iconForEventType(type: string): Icon {
  return ICONS[type] ?? Circle;
}
