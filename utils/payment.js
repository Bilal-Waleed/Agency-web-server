export const calculateHalfPayment = (budget) => {
  if (!budget) return 0;
  const [min, max] = budget.replace(/\$/g, '').split('-').map((val) => parseFloat(val) || 0);
  if (budget.includes('+')) return 3000;
  return ((min + (max || min)) / 2) * 0.5;
};