/**
 * Team Board: the platform team's notes, documents and images in one place
 * (Super Admin > Internal > Team Board). Table `team_board_items`, files in the
 * private `team-board` bucket. Staff only, by RLS.
 *
 * This file is the shape of a post and the rules both dialogs and the page
 * share. No React here.
 */

export type TeamBoardKind = 'note' | 'document' | 'image' | 'voice' | 'video';
export type TeamBoardStatus = 'not_started' | 'in_progress' | 'done';

export interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
}

/** Someone a post can be for. The team, by name: they need no login. */
export interface TeamPerson {
  id: string;
  name: string;
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
  for_person_id: string | null;
  created_at: string;
  updated_at: string;
  creator: TeamMember | null;
  for_person: TeamPerson | null;
}

export const TEAM_BOARD_TABLE = 'team_board_items';
export const TEAM_BOARD_BUCKET = 'team-board';
export const TEAM_BOARD_FAVORITES = 'team_board_favorites';
export const TEAM_BOARD_PEOPLE = 'team_board_people';

export const TEAM_BOARD_COLUMNS = `
  id, kind, body, attachment_path, attachment_name, attachment_type, attachment_size,
  status, created_by, for_person_id, created_at, updated_at,
  creator:app_users!team_board_items_created_by_fkey ( id, name, email, avatar_url ),
  for_person:team_board_people!team_board_items_for_person_id_fkey ( id, name )
`;

export const BODY_MAX = 5000;
/** 1 GB. The bucket and the project's storage cap are set to the same. */
export const FILE_MAX_BYTES = 1024 * 1024 * 1024;

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
  voice: 'Voice note',
  video: 'Video',
};

/** What a voice note says when nothing was typed with it. */
export const VOICE_NOTE_BODY = 'Voice note';

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

const AUDIO_TYPES = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

/** What the file picker offers. The bucket enforces the same list. */
export const ACCEPTED_FILE_TYPES = [...DOCUMENT_TYPES, ...IMAGE_TYPES, ...AUDIO_TYPES, ...VIDEO_TYPES].join(',');

/** `audio/webm;codecs=opus` -> `audio/webm`. The bucket matches on the plain type. */
export function baseType(type: string): string {
  return type.split(';')[0].trim().toLowerCase();
}

/** What kind of post a file makes, or null for a file this board does not take. */
export function kindOfFile(file: { type: string }): Exclude<TeamBoardKind, 'note'> | null {
  const type = baseType(file.type);
  if (IMAGE_TYPES.includes(type)) return 'image';
  if (DOCUMENT_TYPES.includes(type)) return 'document';
  if (AUDIO_TYPES.includes(type)) return 'voice';
  if (VIDEO_TYPES.includes(type)) return 'video';
  return null;
}

/** Why a chosen file cannot be attached, or null when it can. */
export function fileProblem(file: { type: string; size: number }): string | null {
  if (!kindOfFile(file)) return 'That file type is not supported. Attach a PDF, Word, Excel or PowerPoint file, a text file, an image, audio or a video.';
  if (file.size > FILE_MAX_BYTES) return 'That file is larger than 1 GB.';
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
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
  /** 'all', 'team' (posts for everyone), or a person's id. */
  forWho: string;
  /** 'all' or a member's id. */
  postedBy: string;
  /** Only the posts I have starred. */
  favouritesOnly: boolean;
}

export const NO_FILTERS: BoardFilters = { query: '', status: 'all', kind: 'all', forWho: 'all', postedBy: 'all', favouritesOnly: false };

/** `starred` is the set of post ids the person looking has starred. */
export function matchesFilters(item: TeamBoardItem, f: BoardFilters, starred: ReadonlySet<string>): boolean {
  if (f.favouritesOnly && !starred.has(item.id)) return false;
  if (f.status !== 'all' && item.status !== f.status) return false;
  if (f.kind !== 'all' && item.kind !== f.kind) return false;
  if (f.forWho === 'team' && item.for_person_id !== null) return false;
  if (f.forWho !== 'all' && f.forWho !== 'team' && item.for_person_id !== f.forWho) return false;
  if (f.postedBy !== 'all' && item.created_by !== f.postedBy) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  return [item.body, item.attachment_name, memberName(item.creator), item.for_person?.name ?? 'everyone']
    .filter(Boolean)
    .some((v) => (v as string).toLowerCase().includes(q));
}
