const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const stripe =require('stripe')('sk_test_51SNc22F2VQoToP0PnE8tduhF9qLul4MqdAHqpVDfSIw7JOlKe5E4JlSHl11EbWTJZZ96yJsmuzSVxVNK18GrkY1G00AINwP4FA')
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');


const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const PRODUCTS_FILE = path.join(__dirname, 'data', 'books.json');
const CART_FILE = path.join(__dirname, 'data', 'cart.json');
const USER_FILE = path.join(__dirname, 'data', 'users.json');


const readProducts = () => {
  try {
    const data = fs.readFileSync(PRODUCTS_FILE, 'utf8');
    const parsedData = JSON.parse(data);
    return parsedData.products || [];
  } catch (error) {
    console.error('Eroare la citirea produselor: ', error);
    return [];
  }
};

const writeProducts = (products) => {
  const productsData = { products };
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(productsData, null, 2));
};

const readCart = () => {
  try {
    const data = fs.readFileSync(CART_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {
      items: [],
      total: 0,
      totalItems: 0,
      lastUpdated: new Date().toISOString(),
    };
  }
};


const saveCart = (cart) => {
  try {
    cart.lastUpdated = new Date().toISOString();
    fs.writeFileSync(CART_FILE, JSON.stringify(cart, null, 2));
  } catch (error) {
    console.error('Eroare la salvarea cosului:', error);
    throw error;
  }
};

const readUsers = () => {
  try {
    const data = fs.readFileSync(USER_FILE, 'utf8');
    return JSON.parse(data);
  }catch (error) {
    console.error('Eroare la citirea utilizatorilor: ', error);
    return{users: [] };
  }
}

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers ['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if(!token){
    return res.status(401).json({success: false, message:'Token required'});
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, user) =>
   {
    if(err) {
      return res.status(403).json({success: false, message: 'Token invalid'});
    }
    req.user=user;
    next();
   });
};

const requireAdmin = (req, res, next) => {
  if(req.user.role !=='admin') {
    return res.status(403).json({success: false, message: 'Admin access required'});
  }
  next();
};

// === Rute ===
app.get('/api/products', (req, res) => {
  try {
    let products = readProducts();
    products = products.filter(p => p.isActive === true);

    if (req.query.category) {
      products = products.filter(
        p => p.category.toLowerCase() === req.query.category.toLowerCase()
      );
    }

    if (req.query.search) {
      const keyword = req.query.search.toLowerCase();
      products = products.filter(
        p =>
          p.title.toLowerCase().includes(keyword) ||
          p.author.toLowerCase().includes(keyword)
      );
    }

    if (req.query.sort) {
      switch (req.query.sort) {
        case 'price_asc':
          products.sort((a, b) => a.price - b.price);
          break;
        case 'price_desc':
          products.sort((a, b) => b.price - a.price);
          break;
        case 'title_asc':
          products.sort((a, b) => a.title.localeCompare(b.title));
          break;
        case 'title_desc':
          products.sort((a, b) => b.title.localeCompare(a.title));
          break;
      }
    }

    res.json({
      success: true,
      products,
      total: products.length,
      filters: {
        category: req.query.category || null,
        search: req.query.search || null,
        sort: req.query.sort || null,
      },
    });
  } catch (error) {
    console.error('Eroare la obținerea produselor:', error);
    res.status(500).json({ success: false, message: 'Eroare server' });
  }
});

app.get('/', (req, res) => {
  res.json({
    message: 'MERN BookStore API v1',
    description: 'API simplu pentru catalogul de carti',
    version: '1.0.0',
    endpoints: {
      'GET /api/products': 'Obtine toate produsele active',
      'GET /api/products?category=React': 'Filtrearea dupa categorie',
    },
    author: 'SDBIS',
  });
});

// === RUTA POST /api/cart - Adauga un produs in cos ===
app.post('/api/cart', (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;
    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'ID produs este obligatoriu',
      });
    }

    // Citeste produsele pentru a verifica existenta
    const products = readProducts();
    const product = products.find(
      (p) => p.id === productId && p.isActive === true
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produsul nu a fost gasit',
      });
    }

    if (product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: 'Stoc insuficient',
      });
    }

    // Citeste cosul existent sau creeaza unul nou
    const cart = readCart();

    // Verifica daca produsul exista deja in cos
    const existingItemIndex = cart.items.findIndex(
      (item) => item.productId === productId
    );

    if (existingItemIndex > -1) {
      // Actualizeaza cantitatea
      cart.items[existingItemIndex].quantity += quantity;
    } else {
      // Adauga produs nou in cos
      cart.items.push({
        productId,
        quantity,
        title: product.title,
        author: product.author,
        price: product.discountPrice || product.price,
        imageUrl: product.imageUrl,
        addedAt: new Date().toISOString(),
      });
    }

    // Recalculeaza totalul
    cart.total = cart.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    cart.totalItems = cart.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    );

    // Salveaza cosul
    saveCart(cart);

    res.json({
      success: true,
      message: 'Produs adaugat in cos',
      cart: cart,
    });
  } catch (error) {
    console.error('Eroare la adaugarea in cos:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare server la adaugarea in cos',
    });
  }
});

// === RUTA GET /api/cart - Obtine continutul cosului ===
app.get('/api/cart', (req, res) => {
  try {
    const cart = readCart();
    res.json({
      success: true,
      cart: cart,
    });
  } catch (error) {
    console.error('Eroare la obtinerea cosului:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare server la obtinerea cosului',
    });
  }
});

// === RUTA DELETE /api/cart/:productId - Sterge un produs din cos ===
app.delete('/api/cart/:productId', (req, res) => {
  try {
    const { productId } = req.params;
    const cart = readCart();

    const productIdNum = Number(productId);
    cart.items = cart.items.filter(
      (item) => item.productId !== productIdNum
    );

    cart.total = cart.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    cart.totalItems = cart.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    );

    saveCart(cart);
    res.json({
      success: true,
      message: 'Produs sters din cos',
      cart: cart,
    });
  } catch (error) {
    console.error('Eroare la stergerea din cos:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare server la stergerea din cos',
    });
  }
});


app.post('/api/create-checkout-session', async (req, res) => {
  try{
    const { amount, cartItems } = req.body;

    console.log('creeaza sesiune checkout pentru suma de :', amount);

    if(!amount || amount < 1) {
      return res.status(400).json({
        success:false,
        error:'suma invalida'
      });
    }

    const lineItems = [
      ...cartItems.map(item => ({
        price_data: {
          currency: 'ron',
          product_data: {
            name:item.title,
            description:`de ${item.author}`,
            images: [item.imageUrl],
          },
          unit_amount: Math.round(item.price + 100),
        },
        quantity: item.quantity,
      })),
      {
        price_data: {
          currency: 'ron',
          product_data: {
            name: 'Transport',
            description: 'Cost livrare',
          },
          unit_amount: 1999,
        },
        quantity: 1,
      }
    ];

    const sessions = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${req.headers.origin}/payment-success?session_id={CHECKOUT_SESSION_ID}&clear_card=true`,
      cancel_url: `${req.headers.origin}/`,
      metadata: {
        order_type: 'book_store'
      },
    });

    console.log('Sesiune checkout creata:', sessions.id);

    res.json({
      success: true,
      sessionId: sessions.id,
      sessionUrl: sessions.url
    });
  } catch (error){
    console.error('Eroare Stripe:', error);
    res.status(500).json({
      success: false,
      error: 'Eroare la crearea sesiunii de plata'
    });
  }
});

app.get('/api/check-payment-status/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    res.json({
      success: true,
      paymentStatus: session.payment_status,
    });
  } catch (error) {
    res.status(500).json({ success:false, error: 'Eroare verificare plata'});
  }
});

app.post('/api/clear-cart', async (req, res) => {
  try {
    const cart = await readCart();

    cart.items = [];
    cart.total = 0;
    cart.totalItems = 0;

    saveCart(cart);

    res.json({
      success: true,
      message: 'Cos golit cu succes'
    });
  } catch (error) {
    console.log('Eroare la golirea cosului :', error);
    res.status(500).json ({
      success: false,
      message: 'Eroare server la golirea cosului'
    });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Încercare login admin:', email);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email și parola sunt obligatorii',
      });
    }
    const usersData = readUsers();
    const user = usersData.users.find(
      (u) => u.email === email && u.role === 'admin'
    );

    if (!user) {
      console.log('Utilizator admin negăsit:', email);
      return res.status(401).json({
        success: false,
        message: 'Acces restricționat — doar administratori',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log('Parolă incorectă pentru:', email);
      return res.status(401).json({
        success: false,
        message: 'Parolă incorectă',
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '8h' }
    );

    console.log('Login admin reușit:', email);
    return res.json({
      success: true,
      message: 'Autentificare admin reușită',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Eroare la login admin:', error);
    return res.status(500).json({
      success: false,
      message: 'Eroare server la autentificare',
    });
  }
});

app.post('/api/admin/products', authenticateToken, requireAdmin, (req, res) => {
  try {
    const {
      title,
      author,
      price,
      description,
      imageUrl,
      category,
      stock,
      discountPrice,
      isbn,
      publisher,
      pages,
      year,
      rating,
      reviewCount,
      tags,
      featured,
    } = req.body;

    const required = ['title', 'author', 'price', 'stock'];
    const missing = required.filter((f) => !req.body[f]);
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Câmpuri obligatorii lipsă: ${missing.join(', ')}`,
        missingFields: missing,
      });
    }

    //Validari suplimentare
    if (Number(price) < 0) {
      return res.status(400).json({ success: false, message: 'Prețul nu poate fi negativ' });
    }
    if (Number(stock) < 0) {
      return res.status(400).json({ success: false, message: 'Stocul nu poate fi negativ' });
    }
    if (discountPrice != null && Number(discountPrice) > Number(price)) {
      return res.status(400).json({
        success: false,
        message: 'Prețul redus nu poate fi mai mare decât prețul original',
      });
    }

    const products = readProducts(); 
    const last = products[products.length - 1];
    const newId = last ? Number(last.id) + 1 : 1; 

    const newProduct = {
      id: newId,
      title: String(title).trim(),
      author: String(author).trim(),
      isbn: isbn ? String(isbn).trim() : '',
      category: category ? String(category).trim() : 'General',
      price: Number(price),
      discountPrice: discountPrice != null ? Number(discountPrice) : null,
      description: description ? String(description).trim() : '',
      imageUrl: imageUrl ? String(imageUrl).trim() : '/images/default-book.jpg',
      stock: parseInt(stock, 10),
      isActive: true,
      featured: Boolean(featured),
      rating: rating != null ? Number(rating) : null,
      reviewCount: reviewCount != null ? parseInt(reviewCount, 10) : 0,
      tags: Array.isArray(tags) ? tags : [],
      specifications: {
        pages: pages != null ? String(pages) : '',
        language: 'Romanian',
        publisher: publisher ? String(publisher).trim() : '',
        year: year != null ? String(year) : '',
        format: 'Paperback',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.id,
    }; 

    products.push(newProduct);
    writeProducts(products); 

    return res.status(201).json({
      success: true,
      message: 'Produs adăugat cu succes',
      product: newProduct,
    }); 
  } catch (error) {
    console.error('Eroare la adăugarea produsului:', error);
    return res.status(500).json({
      success: false,
      message: 'Eroare server la adăugarea produsului',
      error: error.message,
    }); 
  }
});

// GET /api/admin/products — listare produse pentru admin, cu filtre/paginare/sortare
app.get('/api/admin/products', authenticateToken, requireAdmin, (req, res) => {
  try {
    const {
      category,
      search,
      status = 'all',
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    let products = readProducts(); 

    if (status === 'active') {
      products = products.filter(p => p.isActive === true);
    } else if (status === 'inactive') {
      products = products.filter(p => !p.isActive === false);
    }

    if (category && category !== 'all') {
      const cat = String(category).toLowerCase();
      products = products.filter(p => (p.category || '').toLowerCase().includes(cat));
    }

    if (search) {
      const q = String(search).toLowerCase();
      products = products.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.author || '').toLowerCase().includes(q) ||
        (p.isbn || '').includes(String(search))
      );
    }

    const strFields = new Set(['title', 'author', 'category']);
    const numFields = new Set(['price', 'stock', 'rating']);
    const order = sortOrder === 'asc' ? 1 : -1;

    products.sort((a, b) => {
      const A = a[sortBy];
      const B = b[sortBy];
      if (strFields.has(sortBy)) {
        return order * String(A ?? '').localeCompare(String(B ?? ''));
      }
      if (numFields.has(sortBy)) {
        return order * ((Number(A) || 0) - (Number(B) || 0));
      }
      return order * (new Date(A || 0).getTime() - new Date(B || 0).getTime());
    });


    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;
    const paginatedProducts = products.slice(startIndex, endIndex);

    const totalProducts = products.length;
    const activeProducts = products.filter(p => p.isActive).length;
    const inactiveProducts = products.filter(p => !p.isActive).length;
    const lowStockProducts = products.filter(p => p.stock < 10 && p.stock > 0).length;
    const outOfStockProducts = products.filter(p => p.stock === 0).length;

    res.json({
      success: true,
      products: paginatedProducts,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalProducts / limitNum),
        totalProducts,
        productsPerPage: limitNum,
        hasNextPage: endIndex < totalProducts,
        hasPrevPage: startIndex > 0
      },
      statistics: {
        total: totalProducts,
        active: activeProducts,
        inactive: inactiveProducts,
        lowStock: lowStockProducts,
        outOfStock: outOfStockProducts
      },
      filters: {
        category: category || 'all',
        search: search || '',
        status,
        sortBy,
        sortOrder
      }
    });
  } catch (error) {
    console.error('Eroare la obtinerea produselor admin:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare server la obtinerea produselor'
    });
  }
});


app.put('/api/admin/products/:id', authenticateToken, requireAdmin, (req,
  res) => {
    try {
      const productId = parseInt(req.params.id);
      const updates = req.body;

      let products = readProducts();
      const productIndex = products.findIndex(p => p.id === productId);

      if(productIndex === -1) {
        return res.status(400).json({
          success: false,
          message: 'Produsul nu a fost gasit!'
        });
      }

      products[productIndex] = {
        ...products[productIndex],
        ...updates,
        updateAt: new Date().toISOString()
      };

      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify({products}, null, 2));
      
      res.json ({
        success: true, 
        message: 'Produs actualizat cu succes',
        product: products[productIndex]
      });
    } catch (error) {
      console.error('Eroare la actualizarea produsului:', error);
      res.status(500).json({
        success: false,
        message: 'Eroare server la actualizarea producului'
      });
    }
  }
);


app.delete ('/api/admin/products/:id', authenticateToken, requireAdmin, (req, 
  res) => {
    try{
    const productId = parseInt(req.params.id);
    const { permanent = false} =  req.query;

    let products = readProducts();
    const productIndex = products.findIndex(p => p.id === productId);

     if(productIndex === -1) {
        return res.status(400).json({
          success: false,
          message: 'Produsul nu a fost gasit!'
        });
      }

      if(permanent){
        products.splice(productIndex, 1);
        message='Produs sters definitiv';
      } else {
        products[productIndex].isActive = false;
        products[productIndex].updatedAt = new Date().toISOString();
        message = 'Produs dezactivat cu succes';
      }

      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify({products}, null, 2));
 
      res.json ({
        success: true, 
        message
      });
    } catch (error) {
      console.error('Eroare la actualizarea produsului:', error);
      res.status(500).json({
        success: false,
        message: 'Eroare server la actualizarea producului'
      });
    }
  });

app.get('/api/admin/products/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const products = readProducts();
    const product = products.find(p => p.id === productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produsul nu a fost găsit'
      });
    }

    res.json({
      success: true,
      product
    });

  } catch (error) {
    console.error('Eroare la obținerea produsului:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare server la obținerea produsului'
    });
  }
});


if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\nMERN BookStore API v1`);
    console.log(`Serverul ruleaza pe: http://localhost:${PORT}`);
    console.log(`Produse: http://localhost:${PORT}/api/products`);
    console.log(`\nServer pregatit pentru utilizare!`);
  });
}

module.exports = app;
