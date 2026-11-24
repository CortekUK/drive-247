/**
 * Team Board: the platform team's notes, documents and images in one place
 * (Super Admin > Internal > Team Board). Table `team_board_items`, files in the
 * private `team-board` bucket. Staff only, by RLS.
 *
 * This file is the shape of a post and the rules both dialogs and the page
 * share. No React here.
 */

export type TeamBoardKind = 'note' | 'document' | 'image';
export type TeamBoardStatus = 'not_started' | 'in_progress' | 'done';

export interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface TeamBoardItem {
  id: string;
  kind: TeamBoardKind;
  body: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  status: TeamBoardStatus;
  created_by: string;
  for_user_id: string | null;
  created_at: string;
  updated_at: string;
  creator: TeamMember | null;
  for_user: TeamMember | null;
}

export const TEAM_BOARD_TABLE = 'team_board_items';
export const TEAM_BOARD_BUCKET = 'team-board';

export const TEAM_BOARD_COLUMNS = `
  id, kind, body, attachment_path, attachment_name, attachment_type, attachment_size,
  status, created_by, for_user_id, created_at, updated_at,
  creator:app_users!team_board_items_created_by_fkey ( id, name, email, avatar_url ),
  for_user:app_users!team_board_items_for_user_id_fkey ( id, name, email, avatar_url )
`;

export const BODY_MAX = 5000;
export const FILE_MAX_BYTES = 25 * 1024 * 1024;

/** The three states, in the order work moves through them. */
export const TEAM_BOARD_STATUSES: readonly TeamBoardStatus[] = ['not_started', 'in_progress', 'done'];

export const STATUS_LABEL: Record<TeamBoardStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
};

/** Coloured text, no pill: the same rule every status column in this app follows. */
export const STATUS_TEXT: Record<TeamBoardStatus, string> = {
  not_started: 'text-muted-foreground',
  in_progress: 'text-amber-600 dark:text-amber-400',
  done: 'text-emerald-600 dark:text-emerald-400',
};

export const KIND_LABEL: Record<TeamBoardKind, string> = {
  note: 'Note',
  document: 'Document',
  image: 'Image',
};

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];

/** What the file picker offers. The bucket enforces the same list. */
export const ACCEPTED_FILE_TYPES = [...DOCUMENT_TYPES, ...IMAGE_TYPES].join(',');

/** A document, an image, or (null) a file this board does not take. */
export function kindOfFile(file: { type: string }): Exclude<TeamBoardKind, 'note'> | null {
  if (IMAGE_TYPES.includes(file.type)) return 'image';
  if (DOCUMENT_TYPES.includes(file.type)) return 'document';
  return null;
}

/** Why a chosen file cannot be attached, or null when it can. */
export function fileProblem(file: { type: string; size: number }): string | null {
  if (!kindOfFile(file)) return 'That file type is not supported. Attach a PDF, Word, Excel or PowerPoint file, a text file, or an image.';
  if (file.size > FILE_MAX_BYTES) return 'That file is larger than 25 MB.';
  return null;
}

/** A storage path that is unique and still readable: `<uuid>/<cleaned name>`. */
export function storagePathFor(fileName: string): string {
  const cleaned = fileName
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(-120);
  return `${crypto.randomUUID()}/${cleaned || 'file'}`;
}

export function memberName(member: TeamMember | null | undefined): string {
  if (!member) return 'Someone who has left';
  return member.name?.trim() || member.email;
}

export function initialsOf(member: TeamMember | null | undefined): string {
  const name = memberName(member);
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The first line of a post, for the table. */
export function titleOf(body: string): string {
  return body.trim().split('\n')[0];
}

export interface BoardFilters {
  query: string;
  status: 'all' | TeamBoardStatus;
  kind: 'all' | TeamBoardKind;
  /** 'all', 'team' (posts for everyone), or a member's id. */
  forWho: string;
  /** 'all' or a member's id. */
  postedBy: string;
}

export const NO_FILTERS: BoardFilters = { query: '', status: 'all', kind: 'all', forWho: 'all', postedBy: 'all' };

export function matchesFilters(item: TeamBoardItem, f: BoardFilters): boolean {
  if (f.status !== 'all' && item.status !== f.status) return false;
  if (f.kind !== 'all' && item.kind !== f.kind) return false;
  if (f.forWho === 'team' && item.for_user_id !== null) return false;
  if (f.forWho !== 'all' && f.forWho !== 'team' && item.for_user_id !== f.forWho) return false;
  if (f.postedBy !== 'all' && item.created_by !== f.postedBy) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  return [item.body, item.attachment_name, memberName(item.creator), item.for_user ? memberName(item.for_user) : 'everyone']
    .filter(Boolean)
    .some((v) => (v as string).toLowerCase().includes(q));
}
