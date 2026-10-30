-- Пометка места пользователем: не интересно, мало шансов, уже откликнулась.
-- Отдельная колонка, а не статус: статус двигает сам процесс (разбор, документы),
-- и пометка не должна им перезаписываться.
ALTER TABLE opportunities ADD COLUMN label TEXT
  CHECK (label IS NULL OR label IN ('uninteresting','low_chance','applied'));
