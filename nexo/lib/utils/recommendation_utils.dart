class RecommendationUtils {
  static List<String> getSuggestions(String taskName) {
    final lower = taskName.toLowerCase();
    
    // Default fallback templates
    List<String> templates = [
      "I need an experienced professional for $taskName at my location.",
      "Looking for a reliable person for urgent $taskName work today.",
      "Need high-quality $taskName service with proper equipment.",
      "Seeking a skilled worker for $taskName for a few hours of work.",
      "I require $taskName assistance for my residential property.",
      "Looking for competitive rates for professional $taskName.",
    ];

    if (lower.contains("tractor") || lower.contains("ploughing") || lower.contains("tilling") || lower.contains("agriculture") || lower.contains("farming")) {
      return [
        "Need a tractor with rotavator for 5 acres of deep ploughing.",
        "Looking for experienced tractor driver for land leveling work.",
        "Need urgent tilling service for my field before next week.",
        "Require tractor for harrowing and seed bed preparation.",
        "Looking for reliable tractor rental with experienced operator.",
        "Need help with cultivator work for a medium-sized agricultural plot.",
        "Seeking tractor service for ridge and furrow formation.",
        "Require heavy-duty tractor for clearing and preparing fallow land.",
      ];
    }

    if (lower.contains("mason") || lower.contains("brick") || lower.contains("construction") || lower.contains("building")) {
      return [
        "Need an experienced mason for brick wall construction (approx 500 sqft).",
        "Looking for help with compound wall repair and plastering.",
        "Need a skilled mason for floor tile installation and grouting.",
        "Seeking help with small cement repair work and crack filling.",
        "Require a mason for constructing a new water tank/sump.",
        "Looking for granite platform installation for a kitchen renovation.",
        "Need help with dismantling a wall and debris removal.",
        "Seeking a team for major masonry work on a new floor extension.",
      ];
    }

    if (lower.contains("painter") || lower.contains("putty")) {
      return [
        "Need professional painter for a 3-bedroom house interior.",
        "Looking for putty work and primer application for a new construction.",
        "Need urgent exterior wall painting before the monsoon season.",
        "Seeking expert for texture painting on a single feature wall.",
        "Require professional finish for doors and windows (polishing/painting).",
        "Looking for a painting crew for a full apartment renovation.",
        "Need help with wall dampness treatment before repainting.",
        "Seeking budget-friendly yet high-quality painting service.",
      ];
    }

    if (lower.contains("cleaning")) {
      return [
        "Need full house deep cleaning including kitchen and bathrooms.",
        "Looking for professional sofa and carpet shampooing service.",
        "Need urgent water tank cleaning (underground and overhead).",
        "Seeking bathroom deep cleaning to remove hard water stains.",
        "Require kitchen degreasing and deep cleaning of all cabinets.",
        "Looking for move-in cleaning for a new 2BHK apartment.",
        "Need balcony and window cleaning for a high-rise flat.",
        "Seeking regular weekly cleaning service for a small office.",
      ];
    }

    if (lower.contains("electrician") || lower.contains("repair") || lower.contains("switch")) {
      return [
        "Need an electrician for fixing multiple faulty switches and sockets.",
        "Looking for professional for new light and fan installations.",
        "Need urgent repair for a power trip/short circuit issue.",
        "Seeking help with inverter wiring and battery setup.",
        "Require a technician for refrigerator/washing machine repair.",
        "Looking for AC servicing and gas charging before summer.",
        "Need help with main meter board wiring and MCB replacement.",
        "Seeking a skilled technician for geyser installation and repair.",
      ];
    }

    // Add more specific categories as needed...
    
    // If no specific category matches, return the enriched general templates
    return [
      "I need a professional for $taskName at my home as soon as possible.",
      "Looking for a skilled worker for $taskName with at least 2 years experience.",
      "Need high-quality $taskName service for a small renovation project.",
      "Seeking a reliable person for $taskName work for 4-5 hours today.",
      "I require $taskName assistance for my office/commercial space.",
      "Looking for a professional who can bring their own tools for $taskName.",
      "Need $taskName help for an urgent requirement in my locality.",
      "Seeking a budget-friendly but professional $taskName service.",
      "I need help with $taskName and basic maintenance related to it."
    ];
  }
}
