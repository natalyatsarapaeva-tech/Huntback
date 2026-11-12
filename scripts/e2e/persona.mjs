// Персона для сквозной проверки: вымышленный кандидат и вымышленные вакансии.
export const RESUME = `Elin Strand — Head of Operations

Nordic Freight Group, Stockholm — Head of Operations, 2021 — present
Responsible for operations in Sweden, Denmark and Finland.
Grew the operations team from 8 to 25 people, including 4 managers.
Cut delivery lead time by 40% in two quarters by rebuilding planning.
Moved the warehouse network to a single WMS, saving EUR 620K a year.
Introduced a new carrier tendering process.

Baltic Logistics, Riga — Operations Manager, 2017 — 2021
Launched two new sites at planned volume in 5 months instead of 9.
Reduced late shipments from 12% to 3%.
Improved stakeholder communication with sales.

Education: MSc Industrial Engineering, KTH, 2014.`;

export const EXTRAS = 'Ready to relocate within the EU. Gap in 2016 — travelled.';

const posting = (role, company, city, reqs, extra = '') => `${role}
${company} · ${city}
3 days ago · 48 applicants
Easy Apply
Save
About the job
${extra}We are looking for a ${role} to lead our operations.
Requirements:
${reqs.map(r => '- ' + r).join('\n')}
Show more
Meet the hiring team`;

export const POSTINGS = [
  posting('Head of Operations', 'Fjällbo Logistik', 'Stockholm, Sweden', [
    'Leading operations across several countries',
    'Grew and managed a team of managers',
    'Delivery lead time and on-time performance ownership',
    'Experience with WMS implementation and warehouse network',
    'Carrier procurement and tendering',
    'Executive stakeholder management',
  ]),
  posting('VP Supply Chain', 'Kronvik Retail', 'Göteborg, Sweden', [
    'Supply chain leadership in retail',
    'Reduced late shipments and improved service levels',
    'Budget ownership above EUR 10M',
    'Launch of new distribution sites',
    'S&OP process ownership',
  ]),
  posting('Director of Fulfilment', 'Rheinwerk Versand', 'Berlin, Germany', [
    'Fluent German',
    'Leading a team of 60 people',
    'E-commerce fulfilment',
    'Warehouse network optimisation',
    'Lean and continuous improvement',
  ], 'Team of 60. Fluent German required. '),
];
