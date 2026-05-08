# Scenár predstavenia riešenia na pohovore

Scenár pre časť testu „preveďte ma svojím riešením“. Celkový čas: **~5 minút**.

Cieľom nie je čítať canvas - cieľom je ukázať, *prečo* workflow vyzerá tak, ako vyzerá. Senioritný signál je v dizajnovom zdôvodnení: paralelné logovanie, validácia cez IF, referencovanie názvu nodu v Respond, semantika `onError`. Pred pohovorom si to raz povedz nahlas s časom; ak budeš preťahovať, skráť časť 4 (Clearbit), nie časti o dizajnových rozhodnutiach.

---

## 0. Zarámuj problém (15 s)

> "Vybral som si Task 1, pretože smerovanie leadov je najbežnejšia automatizácia v akomkoľvek B2B stacku - a zároveň mi umožňuje ukázať webhooky, vetvenie, validáciu, paralelné spracovanie a viacero integrácií v jednom workflow. Postavil som to v n8n, pretože celý workflow sa exportuje do JSON súboru, takže to, čo vám idem ukázať, je plne reprodukovateľné - dá sa to importovať a dostanete identické nastavenie."

---

## 1. Ukáž canvas (45 s)

Otvor workflow. Prečítaj nahlas **Overview sticky note** - je tam presne na tento moment.

Kurzorom prejdi happy path:

> "Lead príde sem cez webhook. Validácia, potom IF - zlý vstup hneď dostane čistú 400 odpoveď, dobrý vstup pokračuje ďalej. Enrich, score. Potom sa **Score vetví dvoma smermi** - Sheets loguje paralelne, Switch smeruje podľa tieru. Každá routing vetva volá externé systémy a napája sa do toho istého 200-response nodu, ktorý číta dáta leadu priamo zo Score, takže zlyhávajúca vetva nemôže pokaziť odpoveď."

---

## 2. Klikni na Webhook node (10 s)

> "POST na `/webhook/lead-intake`. Response mode je nastavený na 'response from another node' - volajúci čaká, kým sa routing dokončí, a naspäť dostane JSON s popisom toho, čo sa stalo."

---

## 3. Klikni na "Validate & Normalize" - zdôrazni dizajnové rozhodnutie (45 s)

> "Dôležitý detail: tento Code node pri zlom vstupe *nehádže výnimku*. Vracia flag `valid: false` s chybovou správou."
>
> *(ukáž na IF node)* "Tento IF potom smeruje neplatné leady do `Respond 400` nodu s chybou v tele odpovede."
>
> "Prečo to jednoducho nenechať spadnúť? Pretože v n8n, keď Code node vyhodí chybu vo webhook workflow, workflow sa zastaví skôr, než sa stihne spustiť Respond. Volajúci dostane tiché prázdne 200 - najhoršia možná UX. Pattern flag-and-IF zaručí skutočnú 4xx odpoveď s užitočným telom. Naučil som sa to pri testovaní."

Toto je silný moment. Ukazuje, že si workflow naozaj spúšťal a poučil sa zo skutočného správania, nie že si ho len nakreslil.

---

## 4. Klikni na "Enrich with Mock Clearbit API" a "Map Mock Enrichment" (25 s)

> "Toto je simulácia Clearbitu cez skutočný mock API call, nie iba hardcodovaná logika v Code node. HTTP Request volá lokálnu službu `mock-clearbit` endpointom `/v2/companies/find?domain=...`, ktorý vracia Clearbit-like payload s `metrics.employees` a `category.industry`. Hneď za tým je mapovací Code node, ktorý tento payload prevedie do nášho interného tvaru `enrichment.companySize` a `enrichment.industry`. Ak mock API nie je dostupné, lead pokračuje ako `Unknown` s nulovou veľkosťou firmy."

---

## 5. Klikni na "Score Lead" (25 s)

> "Jeden auditovateľný Code node s bodovacou rubrikou v komentároch. Buckety podľa veľkosti firmy, bonus za industry, celkový súčet, label tieru."
>
> "Zámerne som to nerozdelil do reťaze IFov - keď sa sales o kvartál vráti a povie 'Tech je teraz 5 bodov a chceme bonus pre Healthcare,' chcem zmeniť jeden Code node, nie päť prepojených IFov. Tá istá logika, omnoho čitateľnejšie."

---

## 6. Vysvetli paralelný fan-out zo Score (45 s) - toto je hlavný dizajnový ťah

> "Toto je časť, ktorú by som naozaj zdôraznil. Score má dve odchádzajúce spojenia - jedno do **Sheets vetvy**, druhé do **Switch**. Bežia paralelne."
>
> "Má to dva dôvody. Prvý: **logovanie je nezávislé od routingu** - zlyhanie Sheets nemá blokovať Slack ping a zlyhanie Slacku nemá blokovať audit log. Keď sú to súrodenecké vetvy namiesto sériovej reťaze, toto prepojenie zmizne."
>
> "Druhý: **latencia odpovede**. Sériovo by to bolo `validate + enrich + score + log + route + respond`. Paralelne je to `validate + enrich + score + max(log, route) + respond`. Pri high-volume formulároch na tom záleží."

*(ukáž na malý Format for Sheets Code node medzi Score a Sheets)*

> "Krátka poznámka k tomuto Format nodu - splošťuje vnorené objekty `score` a `enrichment` na presných 9 stĺpcov, ktoré tabuľka potrebuje. Pridal som ho, pretože n8n Sheets node pri prvom zápise automaticky vytvára hlavičky z celého upstream JSONu vrátane vnorených objektov, čo potom rozbije ďalšie appendy chybou column-drift. Zafixovať tvar dát upstream je čistejšie než sa snažiť donútiť Sheets node. Ďalšia vec naučená testovaním, nie diagramovaním."

> "Pri paralelnom fan-oute je malý tradeoff: ak chcem garantovať 'lead je v tabuľke skôr než v Slacku', potrebujem iný dizajn - ale špecifikácia takéto poradie nevyžaduje a recovery je priamočiare cez Error Trigger workflow, ktorý spracuje zlyhané zápisy do tabuľky."

---

## 7. Klikni na Switch (15 s)

> "Tri pomenované výstupy - high, medium, low - podľa tieru, ktorý už score node vypočítal. Čitateľnejšie než vnorené IFy a canvas presne kopíruje špecifikáciu."

---

## 8. Prejdi tri vetvy (45 s)

**High -> Slack + CRM (paralelne)**
> "High-tier spúšťa dve veci paralelne: Slack ping do `#sales-leads` a vytvorenie HubSpot dealu. Obe majú `onError: continueRegularOutput`, takže výpadok Slacku neblokuje CRM a naopak."

**Medium -> Mailchimp**
> "Medium-tier ide do Mailchimp nurture listu s tagom `medium-tier`, aby marketing vedel segmentovať podľa bodovacieho pásma."

**Low -> Resources email**
> "Low-tier dostane šablónový resources email - getting started guide, case studies, pricing - nie sú ignorovaní, ale sales človek kvôli nim nedostane page."

---

## 9. Klikni na "Respond to Webhook" - ukáž na expression (45 s) - toto je druhý senioritný moment

> "Ešte jeden nenápadný, ale dôležitý detail. Pozrite sa na telo odpovede - číta z `$('Score Lead').item.json`, nie z `$json`."
>
> "Keby som použil `$json`, Respond by dostal čokoľvek, čo vyprodukovala upstream vetva. A tu je problém - keď externý node ako Slack zlyhá s `continueRegularOutput`, n8n na regular output porte vráti error object. Takže `$json.email` by bolo `undefined` a odpoveď by bola pokazená."
>
> "Čítanie podľa názvu nodu ťahá dáta zo známeho dobrého výstupu Score Lead bez ohľadu na to, čo sa stalo downstream. Odpoveď ostane správne sformovaná aj vtedy, keď integrácie zlyhajú."

---

## 10. Live demo (45 s)

```bash
./test/send-test.sh all
```

Ukáž, ako v termináli prídu štyri odpovede vrátane `enrichment.source`. Potom v editore -> **Executions** v ľavom sidebare -> klikni na ľubovoľnú jednu -> prejdi dáta node po node. *Toto je najkonkrétnejšia časť dema.*

Ak máš zapojené Slack a Sheets credentials, prepni sa na tieto taby a ukáž nový riadok + správu, ktorá prišla naživo.

---

## 11. Záver - produkčné doplnenia (45 s)

Toto je senioritný moment. Nepreskakuj ho.

> "To, čo tu je, spĺňa špecifikáciu, ale do produkcie by som doplnil:
>
> - **Retries with exponential backoff** na HTTP nodoch - n8n to má zabudované, stačí zapnúť.
> - **Error Trigger workflow**, ktorý zachytí všetko, čo unikne cez `onError: continueRegularOutput`, zapíše to do 'stuck leads' tabuľky a upozorní službu.
> - **Replay workflow** na crone, ktorý túto tabuľku spracuje a skúsi leady znova.
> - **Výmenu mock endpointu za reálny Clearbit + Redis cache**, aby produkcia používala živé dáta a tú istú doménu neobohacovala dvakrát.
> - **Test workflow**, ktorý posiela ukážkové payloady na webhook a overuje tvar odpovede, spustiteľný v CI cez n8n CLI.
>
> Všetkých päť vecí je malých - možno deň práce - ale práve tie z dema spravia niečo, čo sa dá nechať bežať."

---

## Očakávané otázky

**Q: Prečo nelogovať najprv a až potom smerovať sériovo? Nezaručilo by to logovanie pred routingom?**
> Išiel som paralelne z dvoch dôvodov. Prvý: špecifikácia nevyžaduje poradie - hovorí len "log all leads with scores", čo paralelný dizajn spĺňa. Druhý: v sériovom riešení bug v Sheets schéme alebo výpadok Sheets položí aj routing; v paralelnom riešení sú nezávislé. Keby špecifikácia vyžadovala striktné poradie - napríklad "lead musí existovať v tabuľke predtým, než sa notifikuje akýkoľvek externý systém" - pridal by som závislosť Switchu až po Sheets, akceptoval latenciu a nastavil `onError: stopWorkflow` na Sheets, aby sa kontrakt vynútil.

**Q: Prečo Code node na scoring namiesto expressions v Set node?**
> Najmä čitateľnosť. Bodovacia rubrika sa bude meniť - vždy sa mení - a 15-riadková JS funkcia s komentármi sa ďalšiemu človeku upravuje omnoho ľahšie než stack vnorených expressions v Set fieldoch. Tá istá logika, čitateľnejšia.

**Q: Čo ak Clearbit nevráti pre doménu nič?**
> V tejto demo verzii mock API vracia deterministický fallback pre neznáme domény. Ak by API nebolo dostupné, HTTP Request má `onError: continueRegularOutput` a `Map Mock Enrichment` doplní `companySize: 0, industry: 'Unknown', source: 'mock_api_unavailable'`. Score node to vie spracovať - `Unknown` spadne do bucketu "others = 1pt" - takže neobohatený lead jednoducho dostane nízke skóre a resources email, čo je správny default.

**Q: Prečo IF-and-flag pattern na validáciu namiesto jednoduchého throw?**
> Testoval som oboje. Throw zastaví workflow predtým, než sa spustí Respond, takže volajúci webhooku dostane prázdne 200 - zlé. Flag-and-IF dá skutočnú 400 s užitočným telom. Throw prístup by fungoval iba vtedy, keby som pridal Error Trigger workflow len na formátovanie validačnej chyby, čo je viac zapojenia pre rovnaký výsledok.

**Q: Ako by si riešil 1000 leadov/s?**
> n8n v single-process mode by to nezvládlo, takže pri takom volume je to nesprávny nástroj. Dal by som pred to queue - Cloud Pub/Sub alebo SQS, zapisovanú malým webhook handlerom - a n8n v queue mode by z nej ťahalo s horizontálnymi workermi. Samotný workflow by sa nezmenil; zmenil by sa trigger.

**Q: Prečo Respond číta `$('Score Lead')` namiesto toho, aby veril upstream dátam?**
> Pretože `onError: continueRegularOutput` znamená, že zlyhaný externý node stále emituje JSON item na hlavnom output porte - ale ten item je error object, nie pôvodné dáta leadu. Keby Respond použil `$json.email`, výpadok Slacku by pokazil telo odpovede. Ťahať dáta zo Score Lead podľa názvu zaručí správne sformovanú odpoveď bez ohľadu na správanie vetiev.

**Q: Čo ak firma už používa Make.com?**
> Ten istý workflow sa prenesie priamo - Webhook -> Router -> moduly. Patterny sú prenositeľné; líši sa syntax. Portovanie by trvalo asi hodinu, keďže dizajn je už hotový.
