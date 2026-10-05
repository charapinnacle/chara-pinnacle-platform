// ISCO-08 unit groups (4-digit codes) with their titles, as published by the International Labour Organization
// (ISCO-08, 2012). The titles are reproduced with attribution to the ILO. Search synonyms are CHARA additions:
// everyday names that candidates type but that the official titles do not contain.
// Read by scripts/gen-ref-seeds.mjs; the seed it writes is supabase/seeds/ref/occupations.sql.

const UNIT_GROUPS = `
0110|Commissioned armed forces officers
0210|Non-commissioned armed forces officers
0310|Armed forces occupations, other ranks
1111|Legislators
1112|Senior government officials
1113|Traditional chiefs and heads of villages
1114|Senior officials of special-interest organizations
1120|Managing directors and chief executives
1211|Finance managers
1212|Human resource managers
1213|Policy and planning managers
1219|Business services and administration managers not elsewhere classified
1221|Sales and marketing managers
1222|Advertising and public relations managers
1223|Research and development managers
1311|Agricultural and forestry production managers
1312|Aquaculture and fisheries production managers
1321|Manufacturing managers
1322|Mining managers
1323|Construction managers
1324|Supply, distribution and related managers
1330|Information and communications technology services managers
1341|Child care services managers
1342|Health services managers
1343|Aged care services managers
1344|Social welfare managers
1345|Education managers
1346|Financial and insurance services branch managers
1349|Professional services managers not elsewhere classified
1411|Hotel managers
1412|Restaurant managers
1420|Retail and wholesale trade managers
1431|Sports, recreation and cultural centre managers
1439|Services managers not elsewhere classified
2111|Physicists and astronomers
2112|Meteorologists
2113|Chemists
2114|Geologists and geophysicists
2120|Mathematicians, actuaries and statisticians
2131|Biologists, botanists, zoologists and related professionals
2132|Farming, forestry and fisheries advisers
2133|Environmental protection professionals
2141|Industrial and production engineers
2142|Civil engineers
2143|Environmental engineers
2144|Mechanical engineers
2145|Chemical engineers
2146|Mining engineers, metallurgists and related professionals
2149|Engineering professionals not elsewhere classified
2151|Electrical engineers
2152|Electronics engineers
2153|Telecommunications engineers
2161|Building architects
2162|Landscape architects
2163|Product and garment designers
2164|Town and traffic planners
2165|Cartographers and surveyors
2166|Graphic and multimedia designers
2211|Generalist medical practitioners
2212|Specialist medical practitioners
2221|Nursing professionals
2222|Midwifery professionals
2230|Traditional and complementary medicine professionals
2240|Paramedical practitioners
2250|Veterinarians
2261|Dentists
2262|Pharmacists
2263|Environmental and occupational health and hygiene professionals
2264|Physiotherapists
2265|Dieticians and nutritionists
2266|Audiologists and speech therapists
2267|Optometrists and ophthalmic opticians
2269|Health professionals not elsewhere classified
2310|University and higher education teachers
2320|Vocational education teachers
2330|Secondary education teachers
2341|Primary school teachers
2342|Early childhood educators
2351|Education methods specialists
2352|Special needs teachers
2353|Other language teachers
2354|Other music teachers
2355|Other arts teachers
2356|Information technology trainers
2359|Teaching professionals not elsewhere classified
2411|Accountants
2412|Financial and investment advisers
2413|Financial analysts
2421|Management and organization analysts
2422|Policy administration professionals
2423|Personnel and careers professionals
2424|Training and staff development professionals
2431|Advertising and marketing professionals
2432|Public relations professionals
2433|Technical and medical sales professionals (excluding ICT)
2434|Information and communications technology sales professionals
2511|Systems analysts
2512|Software developers
2513|Web and multimedia developers
2514|Applications programmers
2519|Software and applications developers and analysts not elsewhere classified
2521|Database designers and administrators
2522|Systems administrators
2523|Computer network professionals
2529|Database and network professionals not elsewhere classified
2611|Lawyers
2612|Judges
2619|Legal professionals not elsewhere classified
2621|Archivists and curators
2622|Librarians and related information professionals
2631|Economists
2632|Sociologists, anthropologists and related professionals
2633|Philosophers, historians and political scientists
2634|Psychologists
2635|Social work and counselling professionals
2636|Religious professionals
2641|Authors and related writers
2642|Journalists
2643|Translators, interpreters and other linguists
2651|Visual artists
2652|Musicians, singers and composers
2653|Dancers and choreographers
2654|Film, stage and related directors and producers
2655|Actors
2656|Announcers on radio, television and other media
2659|Creative and performing artists not elsewhere classified
3111|Chemical and physical science technicians
3112|Civil engineering technicians
3113|Electrical engineering technicians
3114|Electronics engineering technicians
3115|Mechanical engineering technicians
3116|Chemical engineering technicians
3117|Mining and metallurgical technicians
3118|Draughtspersons
3119|Physical and engineering science technicians not elsewhere classified
3121|Mining supervisors
3122|Manufacturing supervisors
3123|Construction supervisors
3131|Power production plant operators
3132|Incinerator and water treatment plant operators
3133|Chemical processing plant controllers
3134|Petroleum and natural gas refining plant operators
3135|Metal production process controllers
3139|Process control technicians not elsewhere classified
3141|Life science technicians (excluding medical)
3142|Agricultural technicians
3143|Forestry technicians
3151|Ships' engineers
3152|Ships' deck officers and pilots
3153|Aircraft pilots and related associate professionals
3154|Air traffic controllers
3155|Air traffic safety electronics technicians
3211|Medical imaging and therapeutic equipment technicians
3212|Medical and pathology laboratory technicians
3213|Pharmaceutical technicians and assistants
3214|Medical and dental prosthetic technicians
3221|Nursing associate professionals
3222|Midwifery associate professionals
3230|Traditional and complementary medicine associate professionals
3240|Veterinary technicians and assistants
3251|Dental assistants and therapists
3252|Medical records and health information technicians
3253|Community health workers
3254|Dispensing opticians
3255|Physiotherapy technicians and assistants
3256|Medical assistants
3257|Environmental and occupational health inspectors and associates
3258|Ambulance workers
3259|Health associate professionals not elsewhere classified
3311|Securities and finance dealers and brokers
3312|Credit and loans officers
3313|Accounting associate professionals
3314|Statistical, mathematical and related associate professionals
3315|Valuers and loss assessors
3321|Insurance representatives
3322|Commercial sales representatives
3323|Buyers
3324|Trade brokers
3331|Clearing and forwarding agents
3332|Conference and event planners
3333|Employment agents and contractors
3334|Real estate agents and property managers
3339|Business services agents not elsewhere classified
3341|Office supervisors
3342|Legal secretaries
3343|Administrative and executive secretaries
3344|Medical secretaries
3351|Customs and border inspectors
3352|Government tax and excise officials
3353|Government social benefits officials
3354|Government licensing officials
3355|Police inspectors and detectives
3359|Government regulatory associate professionals not elsewhere classified
3411|Legal and related associate professionals
3412|Social work associate professionals
3413|Religious associate professionals
3421|Athletes and sports players
3422|Sports coaches, instructors and officials
3423|Fitness and recreation instructors and programme leaders
3431|Photographers
3432|Interior designers and decorators
3433|Gallery, museum and library technicians
3434|Chefs
3435|Other artistic and cultural associate professionals
3511|Information and communications technology operations technicians
3512|Information and communications technology user support technicians
3513|Computer network and systems technicians
3514|Web technicians
3521|Broadcasting and audiovisual technicians
3522|Telecommunications engineering technicians
4110|General office clerks
4120|Secretaries (general)
4131|Typists and word processing operators
4132|Data entry clerks
4211|Bank tellers and related clerks
4212|Bookmakers, croupiers and related gaming workers
4213|Pawnbrokers and money-lenders
4214|Debt-collectors and related workers
4221|Travel consultants and clerks
4222|Contact centre information clerks
4223|Telephone switchboard operators
4224|Hotel receptionists
4225|Inquiry clerks
4226|Receptionists (general)
4227|Survey and market research interviewers
4229|Client information workers not elsewhere classified
4311|Accounting and bookkeeping clerks
4312|Statistical, finance and insurance clerks
4313|Payroll clerks
4321|Stock clerks
4322|Production clerks
4323|Transport clerks
4411|Library clerks
4412|Mail carriers and sorting clerks
4413|Coding, proofreading and related clerks
4414|Scribes and related workers
4415|Filing and copying clerks
4416|Personnel clerks
4419|Clerical support workers not elsewhere classified
5111|Travel attendants and travel stewards
5112|Transport conductors
5113|Travel guides
5120|Cooks
5131|Waiters
5132|Bartenders
5141|Hairdressers
5142|Beauticians and related workers
5151|Cleaning and housekeeping supervisors in offices, hotels and other establishments
5152|Domestic housekeepers
5153|Building caretakers
5161|Astrologers, fortune-tellers and related workers
5162|Companions and valets
5163|Undertakers and embalmers
5164|Pet groomers and animal care workers
5165|Driving instructors
5169|Personal services workers not elsewhere classified
5211|Stall and market salespersons
5212|Street food salespersons
5221|Shopkeepers
5222|Shop supervisors
5223|Shop sales assistants
5230|Cashiers and ticket clerks
5241|Fashion and other models
5242|Sales demonstrators
5243|Door to door salespersons
5244|Contact centre salespersons
5245|Service station attendants
5246|Food service counter attendants
5249|Sales workers not elsewhere classified
5311|Child care workers
5312|Teachers' aides
5321|Health care assistants
5322|Home-based personal care workers
5329|Personal care workers in health services not elsewhere classified
5411|Firefighters
5412|Police officers
5413|Prison guards
5414|Security guards
5419|Protective services workers not elsewhere classified
6111|Field crop and vegetable growers
6112|Tree and shrub crop growers
6113|Gardeners; horticultural and nursery growers
6114|Mixed crop growers
6121|Livestock and dairy producers
6122|Poultry producers
6123|Apiarists and sericulturists
6129|Animal producers not elsewhere classified
6130|Mixed crop and animal producers
6210|Forestry and related workers
6221|Aquaculture workers
6222|Inland and coastal waters fishery workers
6223|Deep-sea fishery workers
6224|Hunters and trappers
6310|Subsistence crop farmers
6320|Subsistence livestock farmers
6330|Subsistence mixed crop and livestock farmers
6340|Subsistence fishers, hunters, trappers and gatherers
7111|House builders
7112|Bricklayers and related workers
7113|Stonemasons, stone cutters, splitters and carvers
7114|Concrete placers, concrete finishers and related workers
7115|Carpenters and joiners
7119|Building frame and related trades workers not elsewhere classified
7121|Roofers
7122|Floor layers and tile setters
7123|Plasterers
7124|Insulation workers
7125|Glaziers
7126|Plumbers and pipe fitters
7127|Air conditioning and refrigeration mechanics
7131|Painters and related workers
7132|Spray painters and varnishers
7133|Building structure cleaners
7211|Metal moulders and coremakers
7212|Welders and flame cutters
7213|Sheet-metal workers
7214|Structural-metal preparers and erectors
7215|Riggers and cable splicers
7221|Blacksmiths, hammersmiths and forging press workers
7222|Toolmakers and related workers
7223|Metal working machine tool setters and operators
7224|Metal polishers, wheel grinders and tool sharpeners
7231|Motor vehicle mechanics and repairers
7232|Aircraft engine mechanics and repairers
7233|Agricultural and industrial machinery mechanics and repairers
7234|Bicycle and related repairers
7311|Precision-instrument makers and repairers
7312|Musical instrument makers and tuners
7313|Jewellery and precious-metal workers
7314|Potters and related workers
7315|Glass makers, cutters, grinders and finishers
7316|Signwriters, decorative painters, engravers and etchers
7317|Handicraft workers in wood, basketry and related materials
7318|Handicraft workers in textile, leather and related materials
7319|Handicraft workers not elsewhere classified
7321|Pre-press technicians
7322|Printers
7323|Print finishing and binding workers
7411|Building and related electricians
7412|Electrical mechanics and fitters
7413|Electrical line installers and repairers
7421|Electronics mechanics and servicers
7422|Information and communications technology installers and servicers
7511|Butchers, fishmongers and related food preparers
7512|Bakers, pastry-cooks and confectionery makers
7513|Dairy-products makers
7514|Fruit, vegetable and related preservers
7515|Food and beverage tasters and graders
7516|Tobacco preparers and tobacco products makers
7521|Wood treaters
7522|Cabinet-makers and related workers
7523|Woodworking-machine tool setters and operators
7531|Tailors, dressmakers, furriers and hatters
7532|Garment and related patternmakers and cutters
7533|Sewing, embroidery and related workers
7534|Upholsterers and related workers
7535|Pelt dressers, tanners and fellmongers
7536|Shoemakers and related workers
7541|Underwater divers
7542|Shotfirers and blasters
7543|Product graders and testers (excluding foods and beverages)
7544|Fumigators and other pest and weed controllers
7549|Craft and related workers not elsewhere classified
8111|Miners and quarriers
8112|Mineral and stone processing plant operators
8113|Well drillers and borers and related workers
8114|Cement, stone and other mineral products machine operators
8121|Metal processing plant operators
8122|Metal finishing, plating and coating machine operators
8131|Chemical products plant and machine operators
8132|Photographic products machine operators
8141|Rubber products machine operators
8142|Plastic products machine operators
8143|Paper products machine operators
8151|Fibre preparing, spinning and winding machine operators
8152|Weaving and knitting machine operators
8153|Sewing machine operators
8154|Bleaching, dyeing and fabric cleaning machine operators
8155|Fur and leather preparing machine operators
8156|Shoemaking and related machine operators
8157|Laundry machine operators
8159|Textile, fur and leather products machine operators not elsewhere classified
8160|Food and related products machine operators
8171|Pulp and papermaking plant operators
8172|Wood processing plant operators
8181|Glass and ceramics plant operators
8182|Steam engine and boiler operators
8183|Packing, bottling and labelling machine operators
8189|Stationary plant and machine operators not elsewhere classified
8211|Mechanical machinery assemblers
8212|Electrical and electronic equipment assemblers
8219|Assemblers not elsewhere classified
8311|Locomotive engine drivers
8312|Railway brake, signal and switch operators
8321|Motorcycle drivers
8322|Car, taxi and van drivers
8331|Bus and tram drivers
8332|Heavy truck and lorry drivers
8341|Mobile farm and forestry plant operators
8342|Earthmoving and related plant operators
8343|Crane, hoist and related plant operators
8344|Lifting truck operators
8350|Ships' deck crews and related workers
9111|Domestic cleaners and helpers
9112|Cleaners and helpers in offices, hotels and other establishments
9121|Hand launderers and pressers
9122|Vehicle cleaners
9123|Window cleaners
9129|Other cleaning workers
9211|Crop farm labourers
9212|Livestock farm labourers
9213|Mixed crop and livestock farm labourers
9214|Garden and horticultural labourers
9215|Forestry labourers
9216|Fishery and aquaculture labourers
9311|Mining and quarrying labourers
9312|Civil engineering labourers
9313|Building construction labourers
9321|Hand packers
9329|Manufacturing labourers not elsewhere classified
9331|Hand and pedal vehicle drivers
9332|Drivers of animal-drawn vehicles and machinery
9333|Freight handlers
9334|Shelf fillers
9411|Fast food preparers
9412|Kitchen helpers
9510|Street and related services workers
9520|Street vendors (excluding food)
9611|Garbage and recycling collectors
9612|Refuse sorters
9613|Sweepers and related labourers
9621|Messengers, package deliverers and luggage porters
9622|Odd-job persons
9623|Meter readers and vending-machine collectors
9624|Water and firewood collectors
9629|Elementary workers not elsewhere classified
`;

const SYNONYMS = {
  1323: ['site manager', 'building manager'],
  2141: ['production engineer'],
  2142: ['structural engineer'],
  2144: ['mechanic engineer'],
  2151: ['electric engineer'],
  2166: ['graphic designer', 'ux designer'],
  2211: ['doctor', 'physician', 'general practitioner'],
  2212: ['doctor', 'surgeon', 'consultant'],
  2221: ['nurse', 'registered nurse'],
  2230: ['acupuncturist', 'herbalist'],
  2261: ['dental surgeon'],
  2310: ['lecturer', 'professor'],
  2330: ['teacher'],
  2341: ['teacher', 'elementary teacher'],
  2411: ['bookkeeper', 'auditor'],
  2512: ['software engineer', 'programmer', 'developer'],
  2513: ['web developer', 'frontend developer'],
  2522: ['sysadmin', 'it administrator'],
  3112: ['surveyor technician'],
  3123: ['site foreman', 'foreman'],
  3221: ['nurse', 'nursing assistant', 'enrolled nurse'],
  3258: ['paramedic', 'ambulance driver'],
  3343: ['personal assistant', 'pa'],
  3434: ['chef', 'head cook', 'sous chef'],
  3513: ['it technician', 'network technician'],
  4110: ['office assistant', 'administrator'],
  4132: ['typist'],
  4222: ['call centre agent', 'customer service'],
  4226: ['front desk'],
  5120: ['cook', 'kitchen cook', 'line cook'],
  5131: ['waitress', 'server'],
  5132: ['barman', 'barmaid', 'barista'],
  5141: ['barber', 'hair stylist'],
  5151: ['housekeeping supervisor'],
  5152: ['housekeeper', 'maid', 'nanny'],
  5153: ['janitor', 'caretaker'],
  5223: ['shop assistant', 'sales assistant', 'retail assistant'],
  5230: ['cashier', 'checkout operator'],
  5311: ['nanny', 'babysitter', 'childminder'],
  5321: ['care assistant', 'nursing aide', 'healthcare assistant'],
  5322: ['carer', 'home carer', 'home care'],
  5329: ['caregiver', 'care worker', 'carer'],
  5414: ['security officer', 'guard'],
  6111: ['farm worker', 'crop farmer'],
  6113: ['gardener', 'landscaper'],
  6121: ['dairy farmer', 'cattle farmer'],
  7111: ['builder'],
  7112: ['bricklayer', 'mason'],
  7114: ['concrete worker', 'concrete finisher'],
  7115: ['carpenter', 'joiner', 'woodworker'],
  7121: ['roofer', 'roof tiler'],
  7122: ['tiler', 'floor fitter'],
  7123: ['plasterer', 'drywall'],
  7125: ['glazier', 'window fitter'],
  7126: ['plumber', 'pipefitter', 'pipe fitter'],
  7127: ['hvac technician', 'air conditioning technician', 'refrigeration technician'],
  7131: ['painter', 'decorator', 'house painter'],
  7132: ['spray painter'],
  7211: ['foundry worker', 'moulder'],
  7212: ['welder', 'welding', 'mig welder', 'tig welder', 'arc welder', 'pipe welder'],
  7213: ['sheet metal worker', 'metal fabricator'],
  7214: ['steel fixer', 'steel erector', 'metal fabricator', 'fitter'],
  7215: ['rigger', 'scaffolder'],
  7222: ['tool maker', 'die maker'],
  7223: ['cnc operator', 'cnc machinist', 'machinist', 'lathe operator', 'turner'],
  7231: ['mechanic', 'car mechanic', 'auto mechanic', 'vehicle technician'],
  7233: ['machinery mechanic', 'diesel mechanic', 'heavy equipment mechanic'],
  7311: ['watchmaker', 'instrument maker'],
  7411: ['electrician', 'house electrician', 'wireman', 'electrical installer'],
  7412: ['electrician', 'electrical fitter', 'electrical technician', 'maintenance electrician'],
  7413: ['lineman', 'power line worker', 'cable installer'],
  7421: ['electronics technician', 'electronics repairer'],
  7422: ['telecom installer', 'network installer', 'cabling technician'],
  7511: ['butcher', 'fishmonger', 'meat cutter'],
  7512: ['baker', 'pastry chef', 'confectioner'],
  7522: ['cabinet maker', 'furniture maker'],
  7531: ['tailor', 'seamstress', 'dressmaker'],
  7533: ['sewing worker', 'seamstress', 'embroiderer'],
  7541: ['diver', 'commercial diver'],
  8111: ['miner', 'quarry worker'],
  8153: ['sewing machine operator', 'machinist'],
  8182: ['boiler operator', 'stationary engineer'],
  8183: ['packer', 'machine operator'],
  8212: ['electronics assembler', 'production worker'],
  8219: ['assembler', 'production worker', 'assembly line worker'],
  8322: ['driver', 'taxi driver', 'delivery driver', 'van driver', 'chauffeur'],
  8331: ['bus driver', 'tram driver', 'coach driver'],
  8332: ['truck driver', 'lorry driver', 'hgv driver', 'long haul driver'],
  8342: ['excavator operator', 'bulldozer operator', 'digger operator', 'plant operator'],
  8343: ['crane operator', 'tower crane operator'],
  8344: ['forklift operator', 'forklift driver', 'warehouse operator'],
  9111: ['cleaner', 'housemaid', 'house cleaner'],
  9112: ['cleaner', 'janitor', 'hotel cleaner', 'room attendant'],
  9122: ['car washer'],
  9123: ['window washer'],
  9211: ['farm labourer', 'farm hand', 'farm worker', 'picker'],
  9313: ['construction labourer', 'construction worker', 'laborer', 'builder\'s labourer'],
  9321: ['packer', 'packing worker'],
  9329: ['factory worker', 'production worker', 'labourer'],
  9333: ['warehouse worker', 'loader', 'freight handler', 'dock worker'],
  9334: ['stock replenisher', 'shelf stacker', 'shelf filler'],
  9411: ['fast food worker', 'kitchen assistant'],
  9412: ['kitchen hand', 'dishwasher', 'kitchen assistant', 'kitchen porter'],
  9611: ['waste collector', 'refuse collector', 'garbage collector'],
  9621: ['courier', 'delivery person', 'porter', 'bellhop'],
  9622: ['handyman', 'odd job worker'],
};

export const ISCO_UNIT_GROUPS = UNIT_GROUPS.trim()
  .split('\n')
  .map((line) => {
    const [code, label] = line.split('|');
    return { code, label, synonyms: SYNONYMS[code] ?? [] };
  });

for (const code of Object.keys(SYNONYMS)) {
  if (!ISCO_UNIT_GROUPS.some((group) => group.code === code)) throw new Error(`Synonyms for unknown ISCO-08 code ${code}`);
}
