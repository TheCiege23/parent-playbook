
alter type public.measure_source add value if not exists 'video';
comment on type public.measure_source is 'manual: parent typed it. guided: app-led flow. photo: from the on-device body scan. import: bulk import. video: from the on-device jump-height/symmetry capture.';
;
