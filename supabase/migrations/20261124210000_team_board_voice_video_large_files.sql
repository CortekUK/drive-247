-- Team Board: voice notes, videos and much larger files.          (2026-11-24)
--
-- A post can now be a voice note recorded in the browser, or carry a video.
-- The file limit goes from 25 MB to 1 GB. The project-wide storage cap must be
-- at least that too (Storage settings > Global file size limit; it was 50 MB).

alter type public.team_board_kind add value if not exists 'voice';
alter type public.team_board_kind add value if not exists 'video';

update storage.buckets
set file_size_limit = 1073741824, -- 1 GB
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
      'audio/x-m4a',
      'video/mp4',
      'video/quicktime',
      'video/webm'
    ]::text[]
where id = 'team-board';
