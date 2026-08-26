-- B400DWR is historical only. New selections offer B500B (or none).
-- Existing request / weigh / stock rows that already reference B400DWR
-- keep their FK; the code is simply hidden from active dropdowns.

UPDATE steel_classifications
SET is_active = false
WHERE code = 'B400DWR';
