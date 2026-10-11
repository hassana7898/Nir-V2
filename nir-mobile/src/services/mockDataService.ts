/**
 * Comprehensive Offline & Demo Mock Data Service for NIR Mobile Client.
 * Mirrors 100% of the NIR Factory Management System modules:
 * - Exit & Entry Remittances (حواله‌های خروج و ورود خوراک و مواد اولیه)
 * - Digital Weighbridge & Mapping (قبوض باسکول دیجیتال و تطبیق با حواله)
 * - Farmers & Brood Flocks (فهرست مرغداران، دوره‌ها، سن گله و سوابق)
 * - Warehouses & Raw Material Silos (انبارها، موجودی سیلوها و مواد اولیه)
 * - Approvals Cartable (کارتابل تایید سفارشات و بارنامه‌های رانندگان)
 * - Executive KPIs & Search (شاخص‌های کلیدی و جستجوی سراسری)
 */

export const MOCK_USERS = {
  driver: {
    id: 'demo_driver_01',
    username: '09121112233',
    role: 'DRIVER' as const,
    fullName: 'علی کاظمی (راننده پایلوت)',
    phone: '09121112233',
    driverId: 'drv_demo_01',
  },
  farmer: {
    id: 'demo_farmer_01',
    username: '09124445566',
    role: 'FARMER' as const,
    fullName: 'حاج احمد رضایی (مرغداری رضایی)',
    phone: '09124445566',
    farmerId: 'fmr_demo_01',
  },
  manager: {
    id: 'demo_manager_01',
    username: 'admin',
    role: 'MANAGER' as const,
    fullName: 'مهندس حسینی (مدیر کارخانه آرادان)',
    phone: '09129990001',
  },
};

// 1. COMPREHENSIVE INVOICES (REMITTANCES) - EXIT & ENTRY
export const MOCK_ALL_INVOICES = [
  // Exits (خروج محصول)
  {
    id: 'inv_101',
    invoiceNumber: 'REM-1405-0982',
    type: 'exit',
    date: '1405/07/21',
    farmerId: 'fmr_01',
    farmerName: 'مرغداری حاج احمد رضایی',
    farmerPhone: '09124445566',
    productId: 'prod_02',
    productName: 'خوراک پلت مرغ گوشتی (رشد)',
    plannedWeight: 12500,
    amount: 12500,
    scaleNetWeight: 12480,
    weightDelta: -20,
    driverName: 'علی کاظمی',
    driverPhone: '09121112233',
    truckPlate: '۵۸ع۳۲۱ایران۳۴',
    sourceWarehouse: 'سیلوی شماره ۴ پلت آماده',
    destinationAddress: 'گرمسار، جاده حاجی‌آباد، سالن ۲',
    status: 'matched',
    statusLabel: 'منطبق با باسکول (-۲۰ کیلوگرم)',
    weighbridgeTicketId: 'WB-8841',
    transportFee: 35000000,
  },
  {
    id: 'inv_102',
    invoiceNumber: 'REM-1405-0994',
    type: 'exit',
    date: '1405/07/21',
    farmerId: 'fmr_02',
    farmerName: 'مرغداری برادران حسینی',
    farmerPhone: '09127778899',
    productId: 'prod_01',
    productName: 'پیش دان ۱ پلت سوپر',
    plannedWeight: 10200,
    amount: 10200,
    scaleNetWeight: null,
    weightDelta: null,
    driverName: 'علی کاظمی',
    driverPhone: '09121112233',
    truckPlate: '۵۸ع۳۲۱ایران۳۴',
    sourceWarehouse: 'انبار شماره ۵ پیش دان',
    destinationAddress: 'آرادان، ده‌نمک، واحد پرورشی حسینی',
    status: 'pending',
    statusLabel: 'در انتظار باسکول خروج',
    weighbridgeTicketId: null,
    transportFee: 28000000,
  },
  {
    id: 'inv_103',
    invoiceNumber: 'REM-1405-0951',
    type: 'exit',
    date: '1405/07/20',
    farmerId: 'fmr_03',
    farmerName: 'مرغداری صداقت (آقای مرادی)',
    farmerPhone: '09123332211',
    productId: 'prod_03',
    productName: 'پایان دان پلت',
    plannedWeight: 14000,
    amount: 14000,
    scaleNetWeight: 13990,
    weightDelta: -10,
    driverName: 'حسین اکبری',
    driverPhone: '09125556677',
    truckPlate: '۲۲ج۴۵۶ایران۲۴',
    sourceWarehouse: 'سیلوی شماره ۴ پلت آماده',
    destinationAddress: 'سمنان، شهرک صنعتی، مرغداری صداقت',
    status: 'matched',
    statusLabel: 'منطبق با باسکول (-۱۰ کیلوگرم)',
    weighbridgeTicketId: 'WB-8835',
    transportFee: 42000000,
  },
  {
    id: 'inv_104',
    invoiceNumber: 'REM-1405-0934',
    type: 'exit',
    date: '1405/07/19',
    farmerId: 'fmr_04',
    farmerName: 'مجتمع طیور دشت بهشت',
    farmerPhone: '09128889900',
    productId: 'prod_02',
    productName: 'میان دان پلت ۱',
    plannedWeight: 13000,
    amount: 13000,
    scaleNetWeight: 12890,
    weightDelta: -110,
    driverName: 'رضا مرادی',
    driverPhone: '09126667788',
    truckPlate: '۷۷س۷۸۹ایران۳۴',
    sourceWarehouse: 'انبار شماره ۴ پلت',
    destinationAddress: 'گرمسار، روستای فند، واحد ۳',
    status: 'mismatch',
    statusLabel: 'مغایرت وزن (-۱۱۰ کیلوگرم کسری)',
    weighbridgeTicketId: 'WB-8822',
    transportFee: 32000000,
  },
  // Entries (ورود مواد اولیه)
  {
    id: 'inv_201',
    invoiceNumber: 'ENT-1405-0412',
    type: 'entry',
    date: '1405/07/21',
    originName: 'بندر امام خمینی (پایانه شهید رجایی)',
    productId: 'raw_01',
    productName: 'ذرت دامی وارداتی برزیل',
    plannedWeight: 24500,
    amount: 24500,
    scaleNetWeight: 24300,
    weightDelta: -200,
    driverName: 'محمد نوری',
    driverPhone: '09123334455',
    truckPlate: '۳۳د۹۸۷ایران۴۴',
    targetWarehouse: 'سیلوی ۱ مواد اولیه (ذرت)',
    status: 'matched',
    statusLabel: 'تخلیه شد (باسکول ۲۴,۳۰۰ کیلوگرم)',
    weighbridgeTicketId: 'WB-8842',
    transportFee: 68000000,
  },
  {
    id: 'inv_202',
    invoiceNumber: 'ENT-1405-0413',
    type: 'entry',
    date: '1405/07/20',
    originName: 'بندر امیرآباد (کشتی ولگا)',
    productId: 'raw_02',
    productName: 'کنجاله سویا پلت هندوستان',
    plannedWeight: 22000,
    amount: 22000,
    scaleNetWeight: 21950,
    weightDelta: -50,
    driverName: 'احمد قاسمی',
    driverPhone: '09127771122',
    truckPlate: '۱۲ب۳۴۵ایران۱۸',
    targetWarehouse: 'سیلوی ۲ مواد اولیه (سویا)',
    status: 'matched',
    statusLabel: 'تخلیه شد (باسکول ۲۱,۹۵۰ کیلوگرم)',
    weighbridgeTicketId: 'WB-8839',
    transportFee: 54000000,
  },
];

// 2. COMPREHENSIVE FARMERS & BROODS DIRECTORY
export const MOCK_FARMERS_DIRECTORY = [
  {
    id: 'fmr_01',
    name: 'حاج احمد رضایی (مرغداری رضایی)',
    phone: '09124445566',
    address: 'گرمسار، جاده حاجی‌آباد، کیلومتر ۴ سمت راست',
    hallCount: 4,
    capacity: 45000,
    broods: [
      {
        id: 'brood_01',
        name: 'دوره پاییزه سالن ۱ و ۲',
        startDate: '1405/06/15',
        chickCount: 28000,
        breed: 'راس ۳۰۸ (Ross 308)',
        currentAgeDays: 36,
        totalFeedTonnage: 68450,
        status: 'active',
      },
    ],
  },
  {
    id: 'fmr_02',
    name: 'مرغداری برادران حسینی',
    phone: '09127778899',
    address: 'آرادان، ده‌نمک، واحد پرورشی شماره ۲',
    hallCount: 3,
    capacity: 35000,
    broods: [
      {
        id: 'brood_02',
        name: 'دوره دوم گوشتی',
        startDate: '1405/07/02',
        chickCount: 22000,
        breed: 'کاب ۵۰۰ (Cobb 500)',
        currentAgeDays: 19,
        totalFeedTonnage: 31200,
        status: 'active',
      },
    ],
  },
  {
    id: 'fmr_03',
    name: 'مرغداری صداقت (آقای مرادی)',
    phone: '09123332211',
    address: 'سمنان، شهرک صنعتی شرق، جاده نظامی',
    hallCount: 2,
    capacity: 25000,
    broods: [
      {
        id: 'brood_03',
        name: 'دوره جوجه‌ریزی شهریور',
        startDate: '1405/05/28',
        chickCount: 24000,
        breed: 'راس ۳۰۸',
        currentAgeDays: 44,
        totalFeedTonnage: 89000,
        status: 'harvesting',
      },
    ],
  },
  {
    id: 'fmr_04',
    name: 'مجتمع طیور دشت بهشت',
    phone: '09128889900',
    address: 'گرمسار، روستای فند، مجتمع صنعتی',
    hallCount: 6,
    capacity: 80000,
    broods: [
      {
        id: 'brood_04',
        name: 'دوره اول پاییز سالن‌های ۳ تا ۶',
        startDate: '1405/07/10',
        chickCount: 55000,
        breed: 'آربور ایکرز',
        currentAgeDays: 11,
        totalFeedTonnage: 18500,
        status: 'active',
      },
    ],
  },
];

// 3. WAREHOUSES & SILOS (INVENTORY)
export const MOCK_INVENTORY_DETAILS = [
  {
    id: 'wh_silo_1',
    name: 'سیلوی شماره ۱ (ذرت دامی)',
    type: 'raw',
    productName: 'ذرت دامی وارداتی برزیل',
    currentStockKg: 215000,
    capacityKg: 300000,
    unit: 'کیلوگرم',
    percent: 71.6,
    status: 'good',
  },
  {
    id: 'wh_silo_2',
    name: 'سیلوی شماره ۲ (کنجاله سویا)',
    type: 'raw',
    productName: 'کنجاله سویا پلت ۴۴٪ پروتئین',
    currentStockKg: 142000,
    capacityKg: 250000,
    unit: 'کیلوگرم',
    percent: 56.8,
    status: 'good',
  },
  {
    id: 'wh_silo_3',
    name: 'سیلوی شماره ۳ (گندم و جو)',
    type: 'raw',
    productName: 'گندم دامی استاندارد',
    currentStockKg: 68000,
    capacityKg: 150000,
    unit: 'کیلوگرم',
    percent: 45.3,
    status: 'warning',
  },
  {
    id: 'wh_prod_4',
    name: 'انبار شماره ۴ (پلت مرغ رشد آماده)',
    type: 'finished',
    productName: 'خوراک پلت رشد ۲.۵ میلی‌متر',
    currentStockKg: 95000,
    capacityKg: 120000,
    unit: 'کیلوگرم',
    percent: 79.1,
    status: 'good',
  },
  {
    id: 'wh_prod_5',
    name: 'انبار شماره ۵ (پیش دان سوپر)',
    type: 'finished',
    productName: 'پیش دان ۱ پلت کرامبل',
    currentStockKg: 42000,
    capacityKg: 80000,
    unit: 'کیلوگرم',
    percent: 52.5,
    status: 'good',
  },
  {
    id: 'wh_supp_6',
    name: 'انبار شماره ۶ (مکمل‌ها و ریزمغذی‌ها)',
    type: 'supplement',
    productName: 'کنسانتره ۲.۵٪ و ۵٪ گوشتی و تخمگذار',
    currentStockKg: 24500,
    capacityKg: 40000,
    unit: 'کیلوگرم',
    percent: 61.2,
    status: 'good',
  },
];

// 4. WEIGHBRIDGE RECORDS (باسکول دیجیتال)
export const MOCK_WEIGHBRIDGE_RECORDS = [
  {
    id: 'wb_8841',
    ticketNumber: 'WB-8841',
    truckPlate: '۵۸ع۳۲۱ایران۳۴',
    carrierName: 'علی کاظمی',
    driverName: 'علی کاظمی',
    productName: 'خوراک پلت مرغ گوشتی (رشد)',
    type: 'EXIT',
    typeLabel: 'خروج محصول',
    grossWeight: 24800,
    tareWeight: 12300,
    netWeight: 12500,
    status: 'DONE',
    statusLabel: 'توزین کامل',
    matchedInvoiceNumber: 'REM-1405-0982',
    createdAt: '1405/07/21 14:22',
  },
  {
    id: 'wb_8842',
    ticketNumber: 'WB-8842',
    truckPlate: '۳۳د۹۸۷ایران۴۴',
    carrierName: 'محمد نوری',
    driverName: 'محمد نوری',
    productName: 'ذرت دامی وارداتی برزیل',
    type: 'ENTRY',
    typeLabel: 'ورود مواد اولیه',
    grossWeight: 38400,
    tareWeight: 14100,
    netWeight: 24300,
    status: 'DONE',
    statusLabel: 'توزین کامل',
    matchedInvoiceNumber: 'ENT-1405-0412',
    createdAt: '1405/07/21 15:45',
  },
  {
    id: 'wb_8843',
    ticketNumber: 'WB-8843',
    truckPlate: '۲۲ج۴۵۶ایران۲۴',
    carrierName: 'حسین اکبری',
    driverName: 'حسین اکبری',
    productName: 'میان دان پلت ۱',
    type: 'EXIT',
    typeLabel: 'خروج محصول',
    grossWeight: 25100,
    tareWeight: 12210,
    netWeight: 12890,
    status: 'MISMATCH',
    statusLabel: 'مغایرت با فاکتور (۱۱۰ کیلوگرم کسری)',
    matchedInvoiceNumber: 'REM-1405-0934',
    createdAt: '1405/07/20 16:10',
  },
  {
    id: 'wb_8844',
    ticketNumber: 'WB-8844',
    truckPlate: '۱۲ب۳۴۵ایران۱۸',
    carrierName: 'احمد قاسمی',
    driverName: 'احمد قاسمی',
    productName: 'کنجاله سویا پلت',
    type: 'ENTRY',
    typeLabel: 'ورود مواد اولیه',
    grossWeight: 35850,
    tareWeight: 13900,
    netWeight: 21950,
    status: 'DONE',
    statusLabel: 'توزین کامل',
    matchedInvoiceNumber: 'ENT-1405-0413',
    createdAt: '1405/07/20 17:30',
  },
];

// 5. DRIVER LOADS
export const MOCK_DRIVER_LOADS = {
  active: [
    {
      id: 'load_demo_1',
      invoiceNumber: 'REM-1405-0982',
      farmerName: 'مرغداری حاج احمد رضایی',
      farmerPhone: '09124445566',
      productName: 'خوراک پلت مرغ گوشتی (رشد)',
      plannedWeight: 12500,
      sourceWarehouse: 'سیلوی شماره ۴ پلت آماده',
      destinationAddress: 'گرمسار، جاده حاجی‌آباد، مرغداری رضایی، سالن ۲',
      truckPlate: '۵۸ع۳۲۱ایران۳۴',
      status: 'in_transit',
      statusLabel: 'در حال حمل به مرغداری',
      createdAt: '1405/07/21',
      transportFee: 35000000,
    },
    {
      id: 'load_demo_2',
      invoiceNumber: 'REM-1405-0994',
      farmerName: 'مرغداری برادران حسینی',
      farmerPhone: '09127778899',
      productName: 'پیش دان ۱ پلت سوپر',
      plannedWeight: 10200,
      sourceWarehouse: 'انبار شماره ۵ پیش دان',
      destinationAddress: 'آرادان، ده‌نمک، واحد پرورشی حسینی',
      truckPlate: '۵۸ع۳۲۱ایران۳۴',
      status: 'pending',
      statusLabel: 'در انتظار بارگیری',
      createdAt: '1405/07/21',
      transportFee: 28000000,
    },
  ],
  delivered: [
    {
      id: 'load_demo_3',
      invoiceNumber: 'REM-1405-0951',
      farmerName: 'مرغداری صداقت (آقای مرادی)',
      farmerPhone: '09123332211',
      productName: 'پایان دان پلت',
      plannedWeight: 14000,
      sourceWarehouse: 'سیلوی شماره ۴ پلت آماده',
      destinationAddress: 'سمنان، شهرک صنعتی، مرغداری صداقت',
      truckPlate: '۵۸ع۳۲۱ایران۳۴',
      status: 'delivered',
      statusLabel: 'تحویل داده شده',
      createdAt: '1405/07/20',
      transportFee: 42000000,
      deliveredAt: '1405/07/20 16:30',
    },
  ],
};

// 6. FARMER DASHBOARD
export const MOCK_FARMER_DASHBOARD = {
  farmer: {
    id: 'fmr_01',
    fullName: 'حاج احمد رضایی (مرغداری رضایی)',
    phone: '09124445566',
    hallCount: 4,
    capacity: 45000,
  },
  activeBrood: {
    id: 'brood_01',
    name: 'دوره پاییزه سالن ۱ و ۲',
    flockCount: 28000,
    currentAgeDays: 34,
    startDate: '1405/06/15',
    totalFeedTonnage: 68450,
    status: 'active',
  },
  metrics: {
    feedDeliveredTonnage: 68.45,
    pendingDeliveryTonnage: 12.5,
    invoiceCount: 6,
    unsettledAmount: 425000000,
  },
  latestLoad: {
    id: 'load_demo_1',
    invoiceNumber: 'REM-1405-0982',
    productName: 'خوراک پلت مرغ گوشتی (رشد)',
    plannedWeight: 12500,
    status: 'in_transit',
    driverName: 'علی کاظمی',
    driverPhone: '09121112233',
    truckPlate: '۵۸ع۳۲۱ایران۳۴',
  },
};

// 7. MANAGER KPI
export const MOCK_MANAGER_KPI = {
  todayJalali: '۱۴۰۵/۰۷/۲۱',
  todayStats: {
    entryTonnage: 148500,
    exitTonnage: 112300,
    ticketCount: 24,
    discrepancyCount: 2,
    activeBroodsCount: 18,
    totalFlockCount: 385000,
  },
  warehouses: MOCK_INVENTORY_DETAILS,
};

// 8. APPROVALS CARTABLE
export const MOCK_APPROVALS = {
  farmerOrders: [
    {
      id: 'ord_demo_1',
      farmerName: 'مرغداری حاج احمد رضایی',
      productName: 'خوراک پلت مرغ گوشتی (رشد)',
      requestedWeight: 15000,
      targetDeliveryDate: '1405/07/25',
      notes: 'لطفاً تحویل قبل از ظهر صورت پذیرد',
      status: 'pending',
      createdAt: '1405/07/21 09:15',
    },
    {
      id: 'ord_demo_2',
      farmerName: 'مرغداری برادران حسینی',
      productName: 'پیش دان ۱ پلت سوپر',
      requestedWeight: 12000,
      targetDeliveryDate: '1405/07/26',
      notes: 'سیلو سالن شماره ۳ خالی است',
      status: 'pending',
      createdAt: '1405/07/21 11:30',
    },
  ],
  deliveryProofs: [
    {
      id: 'pod_demo_1',
      driverName: 'علی کاظمی',
      invoiceNumber: 'REM-1405-0982',
      farmerName: 'مرغداری حاج احمد رضایی',
      productName: 'خوراک پلت مرغ گوشتی (رشد)',
      photoBillUrl: 'https://placehold.co/600x400/0284c7/ffffff?text=بارنامه+تخلیه',
      photoScaleUrl: 'https://placehold.co/600x400/0284c7/ffffff?text=قبض+باسکول+مقصد',
      signatureUrl: 'https://placehold.co/400x200/ffffff/000000?text=امضای+تحویل‌گیرنده',
      latitude: 35.2145,
      longitude: 52.4891,
      createdAt: '1405/07/21 16:40',
      status: 'pending',
    },
  ],
};

/**
 * Handle endpoint matching and return mock response
 */
export function handleMockRoute(method: string, url: string, body?: any): any | null {
  const cleanUrl = url.replace(/^[a-zA-Z]+:\/\/[^/]+/, '');

  // 1. Meta
  if (cleanUrl.includes('/api/mobile/meta')) {
    return {
      minAppVersion: '1.0.0',
      currentAppVersion: '1.0.1',
      maintenanceMode: false,
      serverTime: new Date().toISOString(),
      todayJalali: '۱۴۰۵/۰۷/۲۱',
      isOfflineDemo: true,
    };
  }

  // 2. Auth OTP Request
  if (cleanUrl.includes('/api/mobile/auth/otp/request')) {
    return {
      success: true,
      message: 'کد تایید ارسال شد (کد آزمایشی: 123456)',
      debugCode: '123456',
    };
  }

  // 3. Auth OTP Verify
  if (cleanUrl.includes('/api/mobile/auth/otp/verify')) {
    const phone = body?.phone || '';
    const user = phone.includes('444') ? MOCK_USERS.farmer : MOCK_USERS.driver;
    return {
      success: true,
      user,
      accessToken: `mock_jwt_${Date.now()}`,
      refreshToken: `mock_refresh_${Date.now()}`,
    };
  }

  // 4. Auth Password Login
  if (cleanUrl.includes('/api/mobile/auth/login') || cleanUrl.includes('/api/auth/login')) {
    return {
      success: true,
      user: MOCK_USERS.manager,
      accessToken: `mock_jwt_${Date.now()}`,
      refreshToken: `mock_refresh_${Date.now()}`,
    };
  }

  // 5. Invoices / Remittances (Exits & Entries)
  if (cleanUrl.includes('/api/invoices') || cleanUrl.includes('/api/mobile/invoices')) {
    return {
      success: true,
      data: MOCK_ALL_INVOICES,
    };
  }

  // 6. Farmers Directory & Broods
  if (cleanUrl.includes('/api/farmers') || cleanUrl.includes('/api/mobile/farmers')) {
    return {
      success: true,
      data: MOCK_FARMERS_DIRECTORY,
    };
  }

  // 7. Warehouses & Silo Inventories
  if (cleanUrl.includes('/api/warehouses') || cleanUrl.includes('/api/inventory') || cleanUrl.includes('/api/mobile/inventory')) {
    return {
      success: true,
      data: MOCK_INVENTORY_DETAILS,
    };
  }

  // 8. Weighbridge Records
  if (cleanUrl.includes('/api/weighbridge') || cleanUrl.includes('/api/mobile/manager/weighbridge')) {
    return {
      success: true,
      data: MOCK_WEIGHBRIDGE_RECORDS,
      records: MOCK_WEIGHBRIDGE_RECORDS,
    };
  }

  // 9. Driver Loads
  if (cleanUrl.includes('/api/mobile/driver/loads')) {
    if (cleanUrl.match(/\/api\/mobile\/driver\/loads\/[^/]+/)) {
      return {
        load: MOCK_DRIVER_LOADS.active[0],
        weighbridge: {
          grossWeight: 24800,
          tareWeight: 12300,
          netWeight: 12500,
          ticketNumber: 'WB-8841',
        },
      };
    }
    return MOCK_DRIVER_LOADS;
  }

  // 10. Driver Proof of Delivery
  if (cleanUrl.includes('/api/mobile/driver/proof')) {
    return {
      success: true,
      message: 'رسید تحویل بار و مدارک باسکول با موفقیت ثبت شد.',
      proofId: `pod_${Date.now()}`,
    };
  }

  // 11. Farmer Dashboard
  if (cleanUrl.includes('/api/mobile/farmer/dashboard')) {
    return MOCK_FARMER_DASHBOARD;
  }

  // 12. Manager KPI
  if (cleanUrl.includes('/api/mobile/manager/kpi')) {
    return MOCK_MANAGER_KPI;
  }

  // 13. Manager Approvals
  if (cleanUrl.includes('/api/mobile/manager/approvals')) {
    return MOCK_APPROVALS;
  }

  // 14. Device Token
  if (cleanUrl.includes('/api/mobile/device-token')) {
    return { success: true, message: 'توکن نوتیفیکیشن ثبت شد' };
  }

  return null;
}
