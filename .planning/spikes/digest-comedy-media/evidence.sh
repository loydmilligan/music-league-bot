#!/usr/bin/env bash
# Re-runs every query behind this spike's claims. Read-only.
# Usage: bash .planning/spikes/digest-comedy-media/evidence.sh [path-to-league.db]
set -euo pipefail
DB="${1:-data/league.db}"
q() { echo; echo "### $1"; sqlite3 -header -column "$DB" "$2"; }

q "E1 — R137 'My Town' (Buck-O-Nine, sub: Sarah Zucker) full ballot" "
select c.name voter, v.points, coalesce(v.comment,'') comment
from votes v join competitors c on c.id=v.voter_id
where v.round_id=137 and v.spotify_uri=(select spotify_uri from ml_submissions where round_id=137 and title='My Town')
order by v.points desc;"

q "E2 — Sarah Zucker's chat reaction (2026-08-02)" "
select ts, sender, text from chat_messages
where group_name like '%Second Best%' and lower(text) like '%ska%' and lower(text) not like '%skate%'
  and ts < '2026-08-03' order by ts;"

q "E3 — R139 'They Dead' final standings (Mashew wins with No Use For A Name)" "
select m.title, m.artists, c.name submitter,
  (select sum(points) from votes v where v.round_id=139 and v.spotify_uri=m.spotify_uri) total
from ml_submissions m left join competitors c on c.id=m.competitor_id
where m.round_id=139 order by total desc;"

q "E4 — R139 'Not Your Savior' full ballot (Sarah Zucker 0, Tj 3)" "
select c.name voter, v.points, coalesce(v.comment,'') comment
from votes v join competitors c on c.id=v.voter_id
where v.round_id=139 and v.spotify_uri=(select spotify_uri from ml_submissions where round_id=139 and title='Not Your Savior')
order by v.points desc;"

q "E5 — R140 NOFX 'Philthy Phil Philanthropist' full ballot (Mashew 3, Layous's fear)" "
select c.name voter, v.points, coalesce(v.comment,'') comment
from votes v join competitors c on c.id=v.voter_id
where v.round_id=140 and v.spotify_uri=(select spotify_uri from ml_submissions where round_id=140 and title like 'Philthy%')
order by v.points desc;"

q "E6 — Mashew's complete R140 ballot (the 3 was tied-highest)" "
select v.points, m.title||' — '||m.artists song, c2.name submitter, coalesce(v.comment,'') comment
from votes v
left join ml_submissions m on m.round_id=140 and m.spotify_uri=v.spotify_uri
left join competitors c2 on c2.id=m.competitor_id
where v.round_id=140 and v.voter_id=(select id from competitors where name='Mashew')
order by v.points desc;"

q "E7 — 'i will even accept ska' in chat (2026-08-28)" "
select ts, sender, text from chat_messages
where group_name like '%Second Best%' and ts between '2026-08-28T03:55' and '2026-08-28T04:05' order by ts;"

q "E8 — every downvote Mashew has cast in Second Best" "
select r.id rnd, m.title||' — '||m.artists song, c2.name submitter, coalesce(v.comment,'') comment
from votes v join rounds r on r.id=v.round_id join seasons s on s.id=r.season_id
left join ml_submissions m on m.round_id=r.id and m.spotify_uri=v.spotify_uri
left join competitors c2 on c2.id=m.competitor_id
where s.league_id=3 and v.voter_id=(select id from competitors where name='Mashew') and v.points<0
order by r.id;"

q "E9 — R137 standings with popularity/runtime (Song Autopsy inputs)" "
select m.title, c.name submitter,
  (select sum(points) from votes v where v.round_id=137 and v.spotify_uri=m.spotify_uri) total,
  (select count(*) from votes v where v.round_id=137 and v.spotify_uri=m.spotify_uri and v.points<0) downvotes,
  sp.spotify_popularity pop, sp.listeners, af.duration_s, af.bpm, af.energy
from ml_submissions m left join competitors c on c.id=m.competitor_id
left join song_popularity sp on sp.spotify_uri=m.spotify_uri
left join song_audio_features af on af.spotify_uri=m.spotify_uri
where m.round_id=137 order by total desc;"

q "E10 — incident 02: 'Not In Nottingham' ballot + JB's prior Robin Hood posts" "
select c.name voter, v.points, coalesce(v.comment,'') comment
from votes v join competitors c on c.id=v.voter_id
where v.round_id=137 and v.spotify_uri=(select spotify_uri from ml_submissions where round_id=137 and title like '%Nottingham%')
order by v.points desc;"

q "E11 — the two Sarahs are two people (dossier conflates them)" "
select c.id competitor_id, c.name ml_name, p.name real_name
from competitors c left join players p on p.id=c.player_id
where c.name in ('Sarah','Sarah S');"

q "E12 — NO BIT candidate: total surviving evidence for 'the Frank Black Embargo'" "
select ts, sender, text from chat_messages
where group_name like '%Second Best%' and (lower(text) like '%embargo%' or lower(text) like '%frank black%')
order by ts;"
