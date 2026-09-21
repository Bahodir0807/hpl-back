export const FACADE_MATERIAL_CATEGORIES = [
  'HPL',
  'SUBSYSTEM',
  'INSULATION',
  'MEMBRANE',
  'FASTENER',
  'SEALING_TAPE',
  'ADDITIONAL',
] as const;

export type FacadeMaterialCategoryCode =
  (typeof FACADE_MATERIAL_CATEGORIES)[number];

export const FACADE_MATERIAL_UNITS = ['M2', 'PCS', 'LM'] as const;

export type FacadeMaterialUnitCode = (typeof FACADE_MATERIAL_UNITS)[number];

export const BASE_FACADE_CONFIG_CODE = 'HPL_FACADE_BASE_1220_3050';
export const BASE_FACADE_NORM_SET_CODE = 'HPL_FACADE_BASE_1220_3050_V1';
export const BASE_FACADE_PANEL_WIDTH_MM = 1220;
export const BASE_FACADE_PANEL_HEIGHT_MM = 3050;
export const BASE_FACADE_PANEL_AREA_M2 = '3.721';

export type FacadeNormDefinition = {
  sortOrder: number;
  code: string;
  nameRu: string;
  nameEn: string;
  nameUz: string;
  category: FacadeMaterialCategoryCode;
  unit: FacadeMaterialUnitCode;
  qtyPerM2: string;
  spec: Record<string, string | number>;
};

/**
 * Source: user-supplied consumption table, column «В среднем на 1 м² HPL».
 * Original spreadsheet was not available in the workspace; names, units and
 * rates below are taken from that table listing. Manufacturer, coating,
 * packaging and other attributes were not provided and are not invented.
 */
export const BASE_FACADE_NORMS_V1: readonly FacadeNormDefinition[] = [
  {
    sortOrder: 1,
    code: 'hpl_panel_1220_3050',
    nameRu: 'HPL-панель 1220×3050 мм',
    nameEn: 'HPL panel 1220×3050 mm',
    nameUz: 'HPL panel 1220×3050 mm',
    category: 'HPL',
    unit: 'M2',
    qtyPerM2: '1.06',
    spec: { sizeMm: '1220×3050', areaM2: '3.721' },
  },
  {
    sortOrder: 2,
    code: 'basalt_board_50mm_1_layer',
    nameRu: 'Базальтовая плита, 1 слой, 50 мм',
    nameEn: 'Basalt board, 1 layer, 50 mm',
    nameUz: 'Bazalt plita, 1 qatlam, 50 mm',
    category: 'INSULATION',
    unit: 'M2',
    qtyPerM2: '1.05',
    spec: { layers: 1, thicknessMm: 50 },
  },
  {
    sortOrder: 3,
    code: 'membrane',
    nameRu: 'Мембрана',
    nameEn: 'Membrane',
    nameUz: 'Membrana',
    category: 'MEMBRANE',
    unit: 'M2',
    qtyPerM2: '1.16',
    spec: {},
  },
  {
    sortOrder: 4,
    code: 'bracket_50_100_80_t2',
    nameRu: 'Кронштейн 50×100×80, t=2,0 мм',
    nameEn: 'Bracket 50×100×80, t=2.0 mm',
    nameUz: 'Kronshteyn 50×100×80, t=2,0 mm',
    category: 'SUBSYSTEM',
    unit: 'PCS',
    qtyPerM2: '4.03',
    spec: { sectionMm: '50×100×80', thicknessMm: 2.0 },
  },
  {
    sortOrder: 5,
    code: 'bracket_50_100_100_t2',
    nameRu: 'Кронштейн 50×100×100, t=2,0 мм',
    nameEn: 'Bracket 50×100×100, t=2.0 mm',
    nameUz: 'Kronshteyn 50×100×100, t=2,0 mm',
    category: 'SUBSYSTEM',
    unit: 'PCS',
    qtyPerM2: '0.81',
    spec: { sectionMm: '50×100×100', thicknessMm: 2.0 },
  },
  {
    sortOrder: 6,
    code: 'paronite_50_80',
    nameRu: 'Паронит под кронштейн 50×80 мм',
    nameEn: 'Paronite pad for 50×80 mm bracket',
    nameUz: 'Kronshteyn uchun paronit 50×80 mm',
    category: 'SUBSYSTEM',
    unit: 'PCS',
    qtyPerM2: '4.03',
    spec: { sizeMm: '50×80' },
  },
  {
    sortOrder: 7,
    code: 'paronite_50_100',
    nameRu: 'Паронит под кронштейн 50×100 мм',
    nameEn: 'Paronite pad for 50×100 mm bracket',
    nameUz: 'Kronshteyn uchun paronit 50×100 mm',
    category: 'SUBSYSTEM',
    unit: 'PCS',
    qtyPerM2: '0.81',
    spec: { sizeMm: '50×100' },
  },
  {
    sortOrder: 8,
    code: 'profile_t_80_50',
    nameRu: 'Профиль вертикальный T 80×50 мм',
    nameEn: 'Vertical T profile 80×50 mm',
    nameUz: 'Vertikal T profil 80×50 mm',
    category: 'SUBSYSTEM',
    unit: 'LM',
    qtyPerM2: '1.67',
    spec: { sectionMm: '80×50', shape: 'T' },
  },
  {
    sortOrder: 9,
    code: 'profile_l_50_80',
    nameRu: 'Профиль угловой L 50×80 мм',
    nameEn: 'Corner L profile 50×80 mm',
    nameUz: 'Burchak L profil 50×80 mm',
    category: 'SUBSYSTEM',
    unit: 'LM',
    qtyPerM2: '0.67',
    spec: { sectionMm: '50×80', shape: 'L' },
  },
  {
    sortOrder: 10,
    code: 'profile_l_50_40_slopes',
    nameRu: 'Профиль угловой L 50×40 мм на откосы',
    nameEn: 'Corner L profile 50×40 mm for slopes',
    nameUz: 'Qiyaliklar uchun burchak L profil 50×40 mm',
    category: 'SUBSYSTEM',
    unit: 'LM',
    qtyPerM2: '0.07',
    spec: { sectionMm: '50×40', shape: 'L', use: 'slopes' },
  },
  {
    sortOrder: 11,
    code: 'fire_cut_l_100_50',
    nameRu: 'Противопожарная отсечка L 100×50 мм',
    nameEn: 'Fire cut-off L 100×50 mm',
    nameUz: 'Yong‘inga qarshi kesish L 100×50 mm',
    category: 'SUBSYSTEM',
    unit: 'LM',
    qtyPerM2: '0.09',
    spec: { sectionMm: '100×50', shape: 'L' },
  },
  {
    sortOrder: 12,
    code: 'anchor_8x80',
    nameRu: 'Анкер для кронштейна 8×80 мм',
    nameEn: 'Bracket anchor 8×80 mm',
    nameUz: 'Kronshteyn ankori 8×80 mm',
    category: 'FASTENER',
    unit: 'PCS',
    qtyPerM2: '4.03',
    spec: { sizeMm: '8×80' },
  },
  {
    sortOrder: 13,
    code: 'anchor_10x100',
    nameRu: 'Анкер для кронштейна 10×100 мм',
    nameEn: 'Bracket anchor 10×100 mm',
    nameUz: 'Kronshteyn ankori 10×100 mm',
    category: 'FASTENER',
    unit: 'PCS',
    qtyPerM2: '1.61',
    spec: { sizeMm: '10×100' },
  },
  {
    sortOrder: 14,
    code: 'dowel_nail_8x115',
    nameRu: 'Дюбель-гвоздь грибок 8×115',
    nameEn: 'Mushroom dowel nail 8×115',
    nameUz: 'Qo‘ziqorin dyubel-mix 8×115',
    category: 'FASTENER',
    unit: 'PCS',
    qtyPerM2: '6.99',
    spec: { sizeMm: '8×115' },
  },
  {
    sortOrder: 15,
    code: 'epdm_tape_60',
    nameRu: 'Лента EPDM 60 мм на профиль',
    nameEn: 'EPDM tape 60 mm on profile',
    nameUz: 'Profil uchun EPDM lenta 60 mm',
    category: 'SEALING_TAPE',
    unit: 'LM',
    qtyPerM2: '1.34',
    spec: { widthMm: 60, material: 'EPDM' },
  },
  {
    sortOrder: 16,
    code: 'membrane_tape',
    nameRu: 'Лента для мембраны',
    nameEn: 'Membrane tape',
    nameUz: 'Membrana lentasi',
    category: 'SEALING_TAPE',
    unit: 'LM',
    qtyPerM2: '1.21',
    spec: {},
  },
  {
    sortOrder: 17,
    code: 'rivet_5x10_head_8_10',
    nameRu: 'Заклёпки 5×10 мм, шляпка 8–10',
    nameEn: 'Rivets 5×10 mm, head 8–10',
    nameUz: 'Zaklyopkalar 5×10 mm, shapka 8–10',
    category: 'FASTENER',
    unit: 'PCS',
    qtyPerM2: '12.09',
    spec: { sizeMm: '5×10', headMm: '8–10' },
  },
  {
    sortOrder: 18,
    code: 'rivet_hpl_5x15_head_15',
    nameRu: 'Заклёпки для HPL 5×15 мм, шляпка 15 мм',
    nameEn: 'HPL rivets 5×15 mm, head 15 mm',
    nameUz: 'HPL zaklyopkalari 5×15 mm, shapka 15 mm',
    category: 'FASTENER',
    unit: 'PCS',
    qtyPerM2: '10.75',
    spec: { sizeMm: '5×15', headMm: 15 },
  },
];

export const EXPECTED_QTY_FOR_1000_M2: Record<string, string> = {
  hpl_panel_1220_3050: '1060',
  basalt_board_50mm_1_layer: '1050',
  membrane: '1160',
  bracket_50_100_80_t2: '4030',
  bracket_50_100_100_t2: '810',
  paronite_50_80: '4030',
  paronite_50_100: '810',
  profile_t_80_50: '1670',
  profile_l_50_80: '670',
  profile_l_50_40_slopes: '70',
  fire_cut_l_100_50: '90',
  anchor_8x80: '4030',
  anchor_10x100: '1610',
  dowel_nail_8x115: '6990',
  epdm_tape_60: '1340',
  membrane_tape: '1210',
  rivet_5x10_head_8_10: '12090',
  rivet_hpl_5x15_head_15: '10750',
};
