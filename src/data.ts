export const employees = [
  { name: 'Sophie Martin', role: 'Responsable RH', team: 'Ressources humaines', status: 'Actif', initials: 'SM', color: 'violet' },
  { name: 'Thomas Bernard', role: 'Lead développeur', team: 'Produit & Tech', status: 'Actif', initials: 'TB', color: 'blue' },
  { name: 'Lina Benali', role: 'Product designer', team: 'Produit & Tech', status: 'En congé', initials: 'LB', color: 'orange' },
  { name: 'Hugo Leroy', role: 'Commercial grands comptes', team: 'Ventes', status: 'Actif', initials: 'HL', color: 'green' },
  { name: 'Emma Petit', role: 'Contrôleuse de gestion', team: 'Finance', status: 'Actif', initials: 'EP', color: 'pink' },
]

export const leaveRequests = [
  { employee: 'Lina Benali', type: 'Congés payés', dates: '19 – 30 août 2026', duration: '10 jours', status: 'Approuvée', initials: 'LB' },
  { employee: 'Hugo Leroy', type: 'RTT', dates: '21 août 2026', duration: '1 jour', status: 'À valider', initials: 'HL' },
  { employee: 'Thomas Bernard', type: 'Congés payés', dates: '7 – 11 septembre 2026', duration: '5 jours', status: 'À valider', initials: 'TB' },
]

export const documents = [
  { title: 'Politique de télétravail', category: 'Politiques RH', updated: '12 août 2026', type: 'PDF' },
  { title: 'Guide d’intégration', category: 'Onboarding', updated: '8 août 2026', type: 'PDF' },
  { title: 'Modèle d’entretien annuel', category: 'Évaluations', updated: '2 août 2026', type: 'DOCX' },
  { title: 'Charte informatique', category: 'Conformité', updated: '28 juillet 2026', type: 'PDF' },
]

export const jobs = [
  { title: 'Développeur·se full-stack', department: 'Produit & Tech', candidates: 12, stage: 'Entretiens', color: 'blue' },
  { title: 'Account executive', department: 'Ventes', candidates: 8, stage: 'Sélection', color: 'green' },
  { title: 'Office manager', department: 'Opérations', candidates: 5, stage: 'Publiée', color: 'orange' },
]

export const reviews = [
  { employee: 'Thomas Bernard', period: 'S1 2026', progress: 100, status: 'Terminée', score: '4,6 / 5' },
  { employee: 'Emma Petit', period: 'S1 2026', progress: 70, status: 'En cours', score: '—' },
  { employee: 'Hugo Leroy', period: 'S1 2026', progress: 30, status: 'À compléter', score: '—' },
]
