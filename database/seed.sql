-- =====================================================================
-- DEMO DATA (optional). Run ONCE after schema.sql.
-- These worlds, topics and questions are SAMPLES for your demo.
-- To replace them: delete the rows from subjects (everything under them is deleted automatically)
-- and add your own, or log in as an instructor and create quizzes in the app.
-- =====================================================================

insert into subjects (name, emoji, color, description) values
  ('Physics',   '⚡', '#4cc9f0', 'World of forces, motion and energy'),
  ('Chemistry', '⚗️', '#ffd166', 'World of atoms, elements and reactions'),
  ('Biology',   '🧬', '#06d6a0', 'World of cells, plants and living organisms')
on conflict (name) do nothing;

insert into topics (subject_id, name) values
  ((select id from subjects where name = 'Physics'),   'Mechanics'),
  ((select id from subjects where name = 'Chemistry'), 'Atomic Structure and Periodic Table'),
  ((select id from subjects where name = 'Biology'),   'Cell: The Unit of Life')
on conflict (subject_id, name) do nothing;

insert into quizzes (topic_id, title, level_no, time_limit_minutes, pass_percent) values
  ((select id from topics where name = 'Mechanics'), 'Motion Basics', 1, 5, 60),
  ((select id from topics where name = 'Atomic Structure and Periodic Table'), 'Meet the Elements', 1, 6, 60),
  ((select id from topics where name = 'Atomic Structure and Periodic Table'), 'Atomic Structure Trials', 2, 6, 60),
  ((select id from topics where name = 'Cell: The Unit of Life'), 'Cell Explorer', 1, 5, 60)
on conflict (topic_id, level_no) do nothing;

-- Physics: Motion Basics
insert into questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, element_number)
select q.id, v.t, v.a, v.b, v.c, v.d, v.ans, v.e, v.diff, v.el
from (select id from quizzes where title = 'Motion Basics') q,
(values
  ('What is the SI unit of force?', 'Joule', 'Newton', 'Watt', 'Pascal', 'B', 'Force = mass x acceleration, measured in newton (kg m/s^2).', 1, null::int),
  ('A 2 kg body accelerates at 3 m/s^2. What is the net force on it?', '1.5 N', '5 N', '6 N', '9 N', 'C', 'F = ma = 2 x 3 = 6 N.', 1, null),
  ('The dimensional formula of work is', 'MLT^-2', 'ML^2T^-2', 'ML^2T^-3', 'MLT^-1', 'B', 'Work = force x distance = (MLT^-2)(L) = ML^2T^-2.', 2, null),
  ('For a given speed, a projectile has maximum horizontal range when the angle of projection is', '30 degrees', '45 degrees', '60 degrees', '90 degrees', 'B', 'Range = u^2 sin(2 theta)/g is maximum when sin(2 theta) = 1, so theta = 45 degrees.', 2, null),
  ('A stone is dropped from a height of 20 m (g = 10 m/s^2). How long does it take to reach the ground?', '1 s', '2 s', '4 s', '1.41 s', 'B', 't = sqrt(2h/g) = sqrt(2 x 20 / 10) = 2 s.', 3, null)
) as v(t, a, b, c, d, ans, e, diff, el);

-- Chemistry level 1: Meet the Elements (each question unlocks an element card)
insert into questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, element_number)
select q.id, v.t, v.a, v.b, v.c, v.d, v.ans, v.e, v.diff, v.el
from (select id from quizzes where title = 'Meet the Elements') q,
(values
  ('What is the atomic number of Carbon?', '4', '6', '8', '12', 'B', 'Carbon has 6 protons, so its atomic number is 6.', 1, 6),
  ('Which element has the symbol Na?', 'Nitrogen', 'Sodium', 'Neon', 'Nickel', 'B', 'Na comes from the Latin name natrium (sodium).', 1, 11),
  ('Which of these is a noble gas?', 'Oxygen', 'Neon', 'Chlorine', 'Nitrogen', 'B', 'Neon is in group 18 with a complete outer shell.', 1, 10),
  ('Which element is the most electronegative?', 'Oxygen', 'Chlorine', 'Fluorine', 'Nitrogen', 'C', 'Fluorine has the highest electronegativity (about 4.0 on the Pauling scale).', 2, 9),
  ('What is the electron distribution (K, L, M) of Magnesium?', '2, 8, 1', '2, 8, 2', '2, 8, 3', '2, 8, 8', 'B', 'Magnesium has 12 electrons: 2 + 8 + 2.', 2, 12),
  ('Which element is a liquid non-metal at room temperature?', 'Mercury', 'Bromine', 'Chlorine', 'Gallium', 'B', 'Bromine is the only non-metal that is liquid at room temperature. Mercury is a metal.', 2, 35)
) as v(t, a, b, c, d, ans, e, diff, el);

-- Chemistry level 2: Atomic Structure Trials
insert into questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, element_number)
select q.id, v.t, v.a, v.b, v.c, v.d, v.ans, v.e, v.diff, v.el
from (select id from quizzes where title = 'Atomic Structure Trials') q,
(values
  ('How many neutrons are in sodium-23 (atomic number 11)?', '11', '12', '23', '10', 'B', 'Neutrons = mass number - atomic number = 23 - 11 = 12.', 2, 11),
  ('Which quantum number decides the SHAPE of an orbital?', 'Principal (n)', 'Azimuthal (l)', 'Magnetic (m)', 'Spin (s)', 'B', 'The azimuthal quantum number l gives the subshell shape: s, p, d, f.', 2, null),
  ('What is the maximum number of electrons in a d subshell?', '6', '10', '14', '2', 'B', 'A d subshell has 5 orbitals and each holds 2 electrons: 10.', 2, null),
  ('Which rule says no two electrons in an atom can have the same four quantum numbers?', 'Hund''s rule', 'Aufbau principle', 'Pauli exclusion principle', 'Heisenberg uncertainty principle', 'C', 'This is the Pauli exclusion principle.', 2, null),
  ('How many unpaired electrons are in a nitrogen atom (1s2 2s2 2p3)?', '1', '2', '3', '0', 'C', 'By Hund''s rule the three 2p electrons occupy three orbitals singly.', 3, 7),
  ('Which element has the highest first ionisation enthalpy in period 2?', 'Nitrogen', 'Oxygen', 'Fluorine', 'Neon', 'D', 'Neon has a complete octet and the highest ionisation enthalpy of the period.', 3, 10)
) as v(t, a, b, c, d, ans, e, diff, el);

-- Biology: Cell Explorer
insert into questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, element_number)
select q.id, v.t, v.a, v.b, v.c, v.d, v.ans, v.e, v.diff, v.el
from (select id from quizzes where title = 'Cell Explorer') q,
(values
  ('Which organelle is called the powerhouse of the cell?', 'Ribosome', 'Mitochondrion', 'Golgi apparatus', 'Lysosome', 'B', 'Mitochondria produce most of the cell''s ATP.', 1, null::int),
  ('Which organelle is the site of protein synthesis?', 'Ribosome', 'Lysosome', 'Vacuole', 'Centriole', 'A', 'Ribosomes translate mRNA into proteins.', 1, null),
  ('The fluid mosaic model of the cell membrane was proposed by', 'Robert Hooke', 'Schleiden and Schwann', 'Singer and Nicolson', 'Watson and Crick', 'C', 'Singer and Nicolson proposed it in 1972.', 2, null),
  ('The cell wall of fungi is mainly made of', 'Cellulose', 'Chitin', 'Peptidoglycan', 'Pectin', 'B', 'Fungal cell walls contain chitin; plant walls contain cellulose.', 2, null),
  ('Which eukaryotic organelle contains 70S ribosomes?', 'Nucleus', 'Mitochondrion', 'Endoplasmic reticulum', 'Golgi apparatus', 'B', 'Mitochondria and chloroplasts have 70S ribosomes, like prokaryotes.', 3, null)
) as v(t, a, b, c, d, ans, e, diff, el);
