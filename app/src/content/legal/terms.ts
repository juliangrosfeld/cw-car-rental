import type { LegalDocument } from './types'

/**
 * CW General Rental Terms & Conditions.
 *
 * VERBATIM from CW_General_Rental_Terms_and_Conditions-2.docx.pdf (Nov 2026).
 * Do not reword, reorder or "tidy" anything in this file: it is the legal text
 * a guest accepts when they tick the box on the booking review step. A change
 * to the wording is a new version of the document from Clay, not a copy edit.
 *
 * The phone numbers inside section 8.1 are part of that text and are therefore
 * NOT read from CONTACT.
 */
export const TERMS: LegalDocument = {
  title: 'General Rental Terms & Conditions',
  letterhead: ['CW Car Sales & Rental', 'Putting Curaçao on the map, one journey at a time.'],
  intro: [
    'These General Rental Terms & Conditions ("Terms") apply to every vehicle rental provided by CW Car Sales & Rental ("CW", "Owner", "we"), operated by Clay J. J. Winklaar, registered in Curaçao under KvK no. 173490 and CRIB no. 102782672. These Terms form part of, and are incorporated by reference into, every signed Car Rental Agreement between CW and a Renter. Where a signed Car Rental Agreement or a separate written agreement expressly modifies a provision of these Terms, that agreement prevails to the extent of the conflict.',
  ],
  sections: [
    {
      heading: '1. Definitions',
      blocks: [
        {
          kind: 'clause',
          number: '1.1',
          text: '“Owner” or “CW” means CW Car Sales & Rental, represented by Clay J. J. Winklaar.',
        },
        {
          kind: 'clause',
          number: '1.2',
          text: '“Renter” means the person named as renter on the Car Rental Agreement, and includes any additional driver named on that Agreement, where the context requires.',
        },
        {
          kind: 'clause',
          number: '1.3',
          text: '“Agreement” means the signed Car Rental Agreement together with these Terms and any Vehicle Handover Record.',
        },
        {
          kind: 'clause',
          number: '1.4',
          text: '“Vehicle” means the vehicle described in the Agreement, together with its keys, documents, and accessories.',
        },
        {
          kind: 'clause',
          number: '1.5',
          text: '“XCG” means Caribbean Guilder, the lawful currency of Curaçao.',
        },
      ],
    },
    {
      heading: '2. Formation of the Agreement',
      blocks: [
        {
          kind: 'clause',
          number: '2.1',
          text: 'A booking is only official once CW confirms it in writing (WhatsApp is fine). Until then, CW does not have to keep a Vehicle for the Renter. A rental begins only once the Renter has signed the Car Rental Agreement (or confirmed acceptance by WhatsApp for existing arrangements) and the Vehicle has been handed over and recorded in a Vehicle Handover Record. For bookings made on the CW website, ticking the “I accept the Terms” box counts as signing. CW also provides the Agreement on paper.',
        },
        {
          kind: 'clause',
          number: '2.2',
          text: 'By signing the Car Rental Agreement, or by taking possession of the Vehicle, the Renter confirms they have read, understood, and agree to these Terms in full.',
        },
        {
          kind: 'clause',
          number: '2.3',
          text: "CW may decline to rent, or may end an existing rental, to any person who does not meet the eligibility requirements in Section 3, who provides false or incomplete information, or at CW's reasonable discretion where CW believes the rental poses an unacceptable risk.",
        },
      ],
    },
    {
      heading: '3. Eligibility to Drive',
      blocks: [
        {
          kind: 'clause',
          number: '3.1',
          text: 'The Renter, and every additional driver, must be at least 21 years old and no older than 75 years old at the start of the rental.',
        },
        {
          kind: 'clause',
          number: '3.2',
          text: 'Every driver must hold a valid category B driving licence (or the equivalent for their home jurisdiction) that they have held for at least one full year.',
        },
        {
          kind: 'clause',
          number: '3.3',
          text: 'Every driver must be listed by name in the Agreement, with the same identifying details required of the Renter (full name, address, date of birth, licence number, passport/ID number, and phone number). There is no additional-driver fee.',
        },
        {
          kind: 'clause',
          number: '3.4',
          text: "No person may drive the Vehicle who is not listed in the Agreement. The Renter must not hand over the keys to, or otherwise permit, an unlisted person to drive. If an unlisted person drives and any accident, damage, fine, or loss occurs, this is a material breach of the Agreement and the Renter is fully responsible for all resulting costs, with no cover from CW's insurance.",
        },
        {
          kind: 'clause',
          number: '3.5',
          text: "No person may drive who is not fit to drive — including anyone without a valid licence, under the applicable minimum age, or impaired by alcohol, drugs, or medication. If an unfit person drives and any accident, damage, fine, or loss occurs, this is a material breach of the Agreement and the Renter and that driver are jointly and fully responsible for all resulting costs, with no cover from CW's insurance.",
        },
        {
          kind: 'clause',
          number: '3.6',
          text: 'The Renter is responsible for the conduct of every driver and passenger of the Vehicle as if the Renter were driving.',
        },
      ],
    },
    {
      heading: '4. Use of the Vehicle',
      blocks: [
        {
          kind: 'clause',
          number: '4.1',
          text: 'Territory. The Vehicle may be driven on the island of Curaçao only.',
        },
        {
          kind: 'clause',
          number: '4.2',
          text: 'Permitted use. The Vehicle is for personal transport only. It may not be used as a taxi, ride-share, delivery vehicle, driving-school vehicle, or for any commercial carriage of paying passengers or goods, and may not be used to tow or push another vehicle.',
        },
        {
          kind: 'clause',
          number: '4.3',
          text: 'No subletting. The Renter may not sublet, lend, or transfer the Vehicle, or any right under the Agreement, to any other person.',
        },
        {
          kind: 'clause',
          number: '4.4',
          text: 'Fuel. The Vehicle is provided with the fuel level recorded at handover. The Renter shall return the Vehicle with at least the same fuel level; any shortfall is charged at the actual cost of fuel.',
        },
        {
          kind: 'clause',
          number: '4.5',
          text: "Condition and care. The Renter shall keep the Vehicle clean, shall not smoke inside the Vehicle, and shall not transport animals in the Vehicle without CW's prior consent. The Renter shall operate the Vehicle in compliance with all applicable Curaçao traffic and road-use laws.",
        },
        {
          kind: 'clause',
          number: '4.6',
          text: 'Inspection. CW and the Renter will inspect the Vehicle together before the rental begins; any existing damage will be noted and photographed on the Vehicle Handover Record. The Vehicle must be returned in the same condition, allowing for normal wear and tear. When the Vehicle is returned, CW and the Renter inspect it together in the same way. If the Renter is not present at return, CW inspects and photographs the Vehicle, and those photos count as the record of its condition.',
        },
      ],
    },
    {
      heading: '5. Rental Period, Delivery & Return',
      blocks: [
        {
          kind: 'clause',
          number: '5.1',
          text: 'The rental period, and the number of rental days charged, are as stated in the Agreement. Both the day of departure and the day of return count as full rental days.',
        },
        {
          kind: 'clause',
          number: '5.2',
          text: 'Delivery and collection. CW delivers and collects the Vehicle anywhere on Curaçao, at any hour, for bookings made through the CW website at least 12 hours before the requested delivery time. Requests with shorter notice, or made outside the website, are subject to availability. Hato Airport is the usual delivery point. Delivery and collection are free of charge.',
        },
        {
          kind: 'clause',
          number: '5.3',
          text: 'Minimum rental. The minimum rental period is 3 days, unless CW agrees otherwise.',
        },
        {
          kind: 'clause',
          number: '5.4',
          text: "Late return. Returning the Vehicle later than the agreed end date and time, without CW's prior agreement, may incur a late-return fee as set out in the Agreement, in addition to an additional daily rental charge for each day or part-day of delay.",
        },
        {
          kind: 'clause',
          number: '5.5',
          text: 'Early return does not entitle the Renter to a refund of unused rental days, unless CW agrees otherwise in writing.',
        },
        {
          kind: 'clause',
          number: '5.6',
          text: 'Vehicle exchange. Where CW needs to substitute the Vehicle for another of comparable category during the rental (for maintenance, repair, or operational reasons), CW will give the Renter reasonable notice — at least 24 hours where practicable (WhatsApp is acceptable notice) — and a new Vehicle Handover Record will be completed.',
        },
        {
          kind: 'clause',
          number: '5.7',
          text: 'Return inspection. The Renter must be at the agreed return place at least 30 minutes before the Renter has to leave or go to any other activity (for example a flight), so that CW can do a full inspection of the Vehicle and discuss with the Renter anything that needs to be discussed. The return inspection takes a maximum of 30 minutes. The Renter may leave or move on only after CW has finished the inspection.',
        },
      ],
    },
    {
      heading: '6. Rates, Fees & Payment',
      blocks: [
        {
          kind: 'clause',
          number: '6.1',
          text: 'The daily rental rate, any cleaning fee, any late-return fee, and any agreed discount are as set out in the Agreement. All amounts are in Caribbean Guilder (XCG) unless stated otherwise.',
        },
        {
          kind: 'clause',
          number: '6.2',
          text: 'Payment is due as set out in the Agreement, by online payment through the CW website, by card where CW offers it, by bank transfer to the CW account stated in the Agreement, or in cash to CW directly. Where a specific payment reference is requested, the Renter shall use it.',
        },
        {
          kind: 'clause',
          number: '6.3',
          text: 'If full payment is not received by the due date, CW may require the Renter to return the Vehicle immediately, and may charge a reasonable administrative fee for late payment, in addition to any other remedy available to CW under the Agreement or these Terms.',
        },
        {
          kind: 'clause',
          number: '6.4',
          text: 'CW does not currently require a security deposit as standard. CW reserves the right to require a security deposit for a specific rental, which will be stated in the Agreement if applicable.',
        },
        {
          kind: 'clause',
          number: '6.5',
          text: 'The Renter is responsible for all fines, tolls, and penalties (traffic, parking, or otherwise) incurred during the rental period, whether notified during or after the rental, plus a reasonable administrative fee for processing any fine received by CW after the Vehicle has been returned.',
        },
      ],
    },
    {
      heading: '7. Insurance',
      blocks: [
        {
          kind: 'clause',
          number: '7.1',
          text: "The Vehicle is covered by third-party liability insurance (WA Extra) under Curaçao law. This covers the Renter's legal liability for damage caused by the Vehicle to other people's property, and covers repair of the Vehicle where another party is at fault.",
        },
        {
          kind: 'clause',
          number: '7.2',
          text: 'This insurance does NOT cover: fire, theft, or glass breakage; damage to the Vehicle where the Renter or an unlisted/unfit driver is at fault; or bodily injury to any person, including the Renter, any driver, or any passenger. The Renter is responsible for arranging their own personal accident, health, or travel insurance if desired.',
        },
        {
          kind: 'clause',
          number: '7.3',
          text: "No additional or optional insurance coverage is sold or arranged by CW. Any supplementary cover must be arranged separately, at the Renter's own cost.",
        },
        {
          kind: 'clause',
          number: '7.4',
          text: 'Where the Renter is at fault in an accident, the Renter shall pay the actual cost of repairing the Vehicle, including the own-risk (eigen risico) of XCG 350 (XCG 475 where the driver at fault is under 23 years old), up to the maximum in Section 8.3. The Renter is also responsible for the actual cost of any other loss or damage the Renter causes, to the extent not covered by the insurance in Section 7.1.',
        },
        {
          kind: 'clause',
          number: '7.5',
          text: 'Where a specific rental is governed by a separate written agreement that displaces the maximum in Section 8.3 or the fault-based liability framework in this Section 7 (for example, a long-term or promotional agreement), the terms of that specific agreement prevail over this Section 7 for that rental only.',
        },
        {
          kind: 'clause',
          number: '7.6',
          text: 'Fully insured vehicle. Where the Agreement states that the Vehicle is fully insured (comprehensive), the Renter is not charged for repair of damage to the Vehicle, including the own-risk. This does not apply where Section 3.4 or 3.5 applies (an unlisted or unfit driver), where Section 8.2 applies (no CRS report), or where Section 8.4 applies (theft while unsecured). In those cases the Renter is fully responsible.',
        },
      ],
    },
    {
      heading: '8. Accidents, Damage & Theft — What To Do',
      blocks: [
        {
          kind: 'clause',
          number: '8.1',
          text: 'In the event of ANY accident, damage, breakdown, or theft involving the Vehicle, the Renter must immediately:',
        },
        {
          kind: 'list',
          items: [
            'Call CRS (Curaçao Security Road Service): 9233 or 0800-1199, or WhatsApp +5999 461-3282, and obtain a CRS report;',
            'Notify CW immediately: WhatsApp +599 9 521 8775 / 527-8555 / 525-8555;',
            'Where the incident involves another party, injury, or suspected theft, also notify the local police and obtain a police report.',
          ],
        },
        {
          kind: 'clause',
          number: '8.2',
          text: 'If CRS is not called and no CRS report is made, the insurance will not cover the damage, and the Renter is personally responsible for the full repair or replacement cost, regardless of fault.',
        },
        {
          kind: 'clause',
          number: '8.3',
          text: 'Fault is determined as follows: where a third party is established as being at fault, the Renter is not responsible for repair costs and CW will pursue recovery from that party or their insurer; where the Renter or another listed driver is at fault, or where fault cannot be established, the Renter is responsible for the cost of repair in accordance with Section 7.4, up to a maximum total of XCG 3,000 for any single incident (including the own-risk of XCG 350, or XCG 475 where the driver at fault is under 23 years old), unless a separate written agreement states otherwise. This maximum does not apply where Section 3.4 or 3.5 applies (an unlisted or unfit driver), where Section 8.2 applies (no CRS report), or where Section 8.4 applies (theft while unsecured); in those cases the Renter is fully responsible for all costs.',
        },
        {
          kind: 'clause',
          number: '8.4',
          text: 'Theft while unsecured. If the Vehicle is stolen while left unlocked, with keys inside, with windows open, or otherwise without reasonable security, the Renter is liable for the full replacement value of the Vehicle, and the maximum-charge provision in Section 8.3 does not apply.',
        },
        {
          kind: 'clause',
          number: '8.5',
          text: "The Renter shall not admit fault, agree to any settlement, or make any payment to a third party in connection with an accident without CW's prior consent.",
        },
      ],
    },
    {
      heading: '9. Breach & Termination',
      blocks: [
        {
          kind: 'clause',
          number: '9.1',
          text: 'CW may terminate the Agreement immediately, without notice, and require the Vehicle be returned immediately, in the event of: non-payment beyond any grace period stated in the Agreement or these Terms; damage to the Vehicle that has not been reported in accordance with Section 8; use of the Vehicle by an unlisted or unfit driver; use outside the permitted territory or permitted use under Section 4; or any other material breach of the Agreement.',
        },
        {
          kind: 'clause',
          number: '9.2',
          text: 'Termination does not affect any liability that has already accrued, including for unpaid rent, fines, fees, or damage.',
        },
      ],
    },
    {
      heading: '10. Liability & Indemnity',
      blocks: [
        {
          kind: 'clause',
          number: '10.1',
          text: 'Except as expressly set out in these Terms, CW is not liable for any indirect, consequential, or incidental loss, including loss of enjoyment, missed connections, or business loss, arising from the rental.',
        },
        {
          kind: 'clause',
          number: '10.2',
          text: "The Renter shall indemnify CW against any claim, fine, cost, or loss arising from the Renter's breach of the Agreement or these Terms, or from the acts or omissions of any driver or passenger of the Vehicle.",
        },
        {
          kind: 'clause',
          number: '10.3',
          text: 'Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited under the laws of Curaçao.',
        },
      ],
    },
    {
      heading: '11. Privacy & Personal Data',
      blocks: [
        {
          kind: 'clause',
          number: '11.1',
          text: 'What we collect and why. To rent you a vehicle, CW collects your identity and contact details, a copy of your driving licence and of your passport or ID, and your rental and payment details. CW uses this information only to verify your identity and eligibility to drive, to carry out and administer the rental, to handle payments, fines, accidents, damage and claims, and to meet its legal obligations.',
        },
        {
          kind: 'clause',
          number: '11.2',
          text: 'Sharing. CW does not sell your personal data and does not use copies of your driving licence or ID for marketing. CW shares personal data only where this is necessary for the rental or required by law — for example with the police and other authorities, CRS, insurers, repairers, legal advisers and courts, and with service providers who help CW run its booking and payment systems and are required to protect your data.',
        },
        {
          kind: 'clause',
          number: '11.3',
          text: 'Security. CW keeps your documents in secure, access-restricted storage. Only CW team members who need them for your rental can open them, each using a personal login. CW does not send copies of your driving licence or ID by e-mail, does not share them in group chats, and does not use them for any purpose other than those in Section 11.1. Please send your documents only through the secure upload or other channel that CW indicates, and not through social media or unsecured channels. If CW becomes aware that your personal data has been accessed or disclosed without authorisation in a way that may affect you, CW will inform you without undue delay.',
        },
        {
          kind: 'clause',
          number: '11.4',
          text: 'Retention. CW keeps your documents only as long as needed for the purposes in Section 11.1 — in general until 12 months after your rental ends — and longer only where needed for an open claim, fine or dispute, or where the law requires it. After that, CW deletes them. Financial and booking records are kept for as long as tax and accounting law requires.',
        },
        {
          kind: 'clause',
          number: '11.5',
          text: 'Your rights. You may ask CW at any time to see, correct or delete the personal data CW holds about you, by contacting CW using the details in Section 12.6. CW will respond within a reasonable time. Deletion may be refused or delayed only where CW needs the data for a reason described in Section 11.4.',
        },
        {
          kind: 'clause',
          number: '11.6',
          text: "Other drivers. The Renter confirms that the information provided is accurate, and that any additional driver has agreed to the Renter providing their details to CW. Their data is handled in the same way as the Renter's.",
        },
        {
          kind: 'clause',
          number: '11.7',
          text: "Privacy Policy. Further detail on how CW handles personal data is set out in the CW Privacy Policy, which is available on CW's website and on request, and forms part of these Terms.",
        },
      ],
    },
    {
      heading: '12. General',
      blocks: [
        {
          kind: 'clause',
          number: '12.1',
          text: 'Entire agreement. The signed Car Rental Agreement, these Terms, and the Vehicle Handover Record together constitute the entire agreement between CW and the Renter relating to the rental, and supersede any prior discussions or understandings.',
        },
        {
          kind: 'clause',
          number: '12.2',
          text: 'Amendments. Any amendment must be in writing and signed, or confirmed by both CW and the Renter via WhatsApp for minor administrative changes.',
        },
        {
          kind: 'clause',
          number: '12.3',
          text: 'Severability. If any provision of these Terms is held invalid or unenforceable, the remaining provisions continue in full force and effect.',
        },
        {
          kind: 'clause',
          number: '12.4',
          text: 'Language. These Terms are written in English, which is the governing version. Any translation is provided for convenience only; in the event of any conflict, the English version prevails.',
        },
        {
          kind: 'clause',
          number: '12.5',
          text: 'Governing law & disputes. These Terms and every Agreement are governed by the laws of Curaçao. Any dispute will be brought before the competent court of Curaçao (Court of First Instance).',
        },
        {
          kind: 'clause',
          number: '12.6',
          text: 'Contact. CW Car Sales & Rental, Kaya Dril 2, Curaçao · KvK 173490 · CRIB 102782672 · WhatsApp +599 9 521 8775.',
        },
      ],
    },
  ],
  footer: 'CW Car Sales & Rental · Clay J. J. Winklaar · KvK 173490 · WhatsApp +599 9 521 8775',
}

/** The exact words a guest ticks on the review step. Shared by the wizard and
 *  anything that later needs to show what was agreed to. */
export const TERMS_ACCEPT_LABEL = 'I have read and accept the Terms & Conditions.'
export const TERMS_LINK_LABEL = 'Terms & Conditions'
