export type ActivityRegressionFixture = {
  name: string;
  query: string;
  expectedSignals: string[];
  disallowedSignals: string[];
};

export const ACTIVITY_REGRESSION_FIXTURES: ActivityRegressionFixture[] = [
  {
    name: "scuba_diving",
    query: "gear for scuba diving",
    expectedSignals: ["waterproof", "underwater", "cam_action"],
    disallowedSignals: ["handlebar", "bike mount", "transmitter"],
  },
  {
    name: "road_cycling",
    query: "road cycling camera setup",
    expectedSignals: ["mount_handlebar", "cam_action", "sports"],
    disallowedSignals: ["underwater housing", "scuba"],
  },
  {
    name: "mountain_biking",
    query: "mountain biking kit",
    expectedSignals: ["mount_helmet", "cam_action", "rugged"],
    disallowedSignals: ["underwater housing", "lavalier"],
  },
  {
    name: "moto_vlogging",
    query: "moto vlogging setup",
    expectedSignals: ["mic_wireless", "mount_helmet", "cam_action"],
    disallowedSignals: ["scuba", "underwater", "bike-only mount"],
  },
  {
    name: "motocross",
    query: "motocross action camera gear",
    expectedSignals: ["cam_action", "mount_helmet", "rugged"],
    disallowedSignals: ["underwater housing", "podcast mic kit"],
  },
  {
    name: "paragliding",
    query: "paragliding recording setup",
    expectedSignals: ["cam_action", "mount_helmet", "stabilized"],
    disallowedSignals: ["underwater", "motocross"],
  },
  {
    name: "base_jumping",
    query: "base jumping camera kit",
    expectedSignals: ["cam_action", "mount_helmet", "compact"],
    disallowedSignals: ["underwater", "bike mount"],
  },
  {
    name: "skydiving",
    query: "skydiving camera setup",
    expectedSignals: ["cam_action", "mount_helmet", "sports"],
    disallowedSignals: ["handlebar", "bike mount", "motorcycle"],
  },
  {
    name: "whitewater_rafting",
    query: "whitewater rafting capture gear",
    expectedSignals: ["waterproof", "cam_action", "mount_wrist"],
    disallowedSignals: ["handlebar", "motorcycle"],
  },
  {
    name: "gym_fitness_creator",
    query: "gym fitness creator setup",
    expectedSignals: ["vlogging", "mic_wireless", "gimbal_phone"],
    disallowedSignals: ["underwater", "propeller"],
  },
  {
    name: "documentary_filmmaking",
    query: "documentary filmmaking kit",
    expectedSignals: ["drone_cinema", "gimbal_camera", "mic_wireless"],
    disallowedSignals: ["motocross", "handlebar"],
  },

  /* ---------- Hierarchy-driven fixtures (one per activity in
   *  `ACTIVITY_HIERARCHIES`). The activity-profiles fixtures above
   *  remain because they exercise the older wave-2 ranking pass,
   *  which is still active. ---------- */
  {
    name: "skiing_snowboarding",
    query: "skiing camera setup",
    expectedSignals: ["cam_action", "mount_helmet", "rugged"],
    disallowedSignals: ["mount_handlebar", "underwater"],
  },
  {
    name: "surfing",
    query: "surfing GoPro alternative",
    expectedSignals: ["cam_action", "waterproof"],
    disallowedSignals: ["mount_handlebar", "drone"],
  },
  {
    name: "hiking_outdoor",
    query: "hiking gear for filming",
    expectedSignals: ["cam_action", "compact"],
    disallowedSignals: ["mount_handlebar", "scuba"],
  },
  {
    name: "travel",
    query: "travel vlogging kit",
    expectedSignals: ["cam_pocket", "compact"],
    disallowedSignals: ["mount_handlebar", "scuba"],
  },
  {
    name: "vlog",
    query: "vlog setup for youtube",
    expectedSignals: ["cam_pocket", "vlogging"],
    disallowedSignals: ["scuba", "drone_cinema"],
  },
  {
    name: "podcast",
    query: "podcast recording at home",
    expectedSignals: ["mic_wireless"],
    disallowedSignals: ["drone", "cam_action", "scuba"],
  },
  {
    name: "interview",
    query: "interview kit for journalism",
    expectedSignals: ["mic_wireless"],
    disallowedSignals: ["drone", "scuba", "motocross"],
  },
  {
    name: "livestream",
    query: "livestream gear for twitch",
    expectedSignals: ["mic_wireless"],
    disallowedSignals: ["scuba", "motocross"],
  },
  {
    name: "wedding",
    query: "wedding videography gear",
    expectedSignals: ["drone_cinema", "gimbal_camera", "mic_wireless"],
    disallowedSignals: ["motocross", "scuba"],
  },
  {
    name: "real_estate_aerial",
    query: "real estate aerial photography",
    expectedSignals: ["drone_cinema"],
    disallowedSignals: ["motocross", "scuba"],
  },
  {
    name: "concert_event",
    query: "concert event recording",
    expectedSignals: ["mic_wireless"],
    disallowedSignals: ["drone", "scuba"],
  },
  {
    name: "theatre",
    query: "theatre performance recording",
    expectedSignals: ["mic_wireless"],
    disallowedSignals: ["drone", "cam_action", "scuba"],
  },
  {
    name: "indoor_sports",
    query: "indoor sports filming gym",
    expectedSignals: ["cam_action"],
    disallowedSignals: ["scuba", "underwater housing"],
  },
  {
    name: "family",
    query: "family vacation video kit",
    expectedSignals: ["cam_pocket"],
    disallowedSignals: ["motocross", "scuba"],
  },
  {
    name: "beginner_creator",
    query: "beginner creator kit",
    expectedSignals: ["cam_pocket"],
    disallowedSignals: ["motocross", "scuba"],
  },
  {
    name: "professional_filmmaker",
    query: "professional filmmaker setup",
    expectedSignals: ["drone_cinema", "gimbal_camera"],
    disallowedSignals: ["motocross", "scuba"],
  },
  {
    name: "phone_photography",
    query: "smartphone photography rig",
    expectedSignals: ["gimbal_phone"],
    disallowedSignals: ["drone", "scuba", "motocross"],
  },
];

