require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;

const corsOptions = {
  origin: "*",
  credentials: true,
  optionSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());

// const uri = "mongodb+srv://<username>:<password>@cluster0.mnum3sy.mongodb.net/?retryWrites=true&w=majority";
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mnum3sy.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const userCollection = client.db("surveyNest").collection("users");
    const surveyCollection = client.db("surveyNest").collection("surveys");
    const paymentCollection = client.db("surveyNest").collection("payments");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      console.log('jwt', token)
      res.send({ token });
    });

    // middleware

    // const verifyToken = (req, res, next) => {
    //   // console.log('inside verify token', req.headers.authorization);
    //   if (!req.headers.authorization) {
    //     return res.status(401).send({ message: 'unauthorized access' });
    //   }
    //   const token = req.headers.authorization.split(' ')[1];

    //   jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    //     if (err) {
    //       return res.status(401).send({ message: 'unauthorized access' })
    //     }
    //     req.decoded = decoded;
    //     next();
    //   })
    // }

    // survey related api

    app.get("/surveys", async (req, res) => {
      // const query = {};
      const cursor = surveyCollection.find();
      const surveys = await cursor.toArray();
      res.send(surveys);
    })

    app.get("/surveys/:id", async (req, res) => {
      const id = req.params.id;
      
      const query = { _id: new ObjectId(id) };
      const survey = await surveyCollection.findOne(query);
      res.send(survey);
    })

    app.post('/surveys',  async (req, res) => {
      const survey = req.body;
      const result = await surveyCollection.insertOne(survey);
      res.send(result);
    })

    // for like
    app.patch('/like/:id', async (req, res) => {
      const id = req.params.id;
      console.log(id)
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $inc: { voted: 1 },
      };
      const result = await surveyCollection.updateOne(query, updatedDoc);
      res.send(result);
    })

    app.patch('/dislike/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $inc: { dislike: 1 },
      };
      const result = await surveyCollection.updateOne(query, updatedDoc);
      res.send(result);
    })

    const verifyToken = (req, res, next) => {
      console.log("inside verify Token", req.headers.authorization);

      if (!req.headers?.authorization) {
        return res.status(401).send({ message: "forbidden access" });
      }
      const token = req?.headers?.authorization?.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "forbidden access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req?.decoded?.email
    
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    }


    // user related Api
    app.get("/users", verifyToken, verifyAdmin,  async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req?.params?.email;
      // console.log(email)
      // if (email !== req.user?.email) {
      //   return res.status(403).send({ message: "unauthorized access" });
      // }
      // console.log(email)

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      let surveyor = false;
      if (user?.role === "admin") {
        admin = user?.role 
      }
      else if (user?.role === "surveyor") {
        surveyor = user?.role
      }
     
      console.log('admin ?',admin)
      res.send({ admin, surveyor });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;

      const query = { email: user?.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const {role} = req.body;
      console.log(role)
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: role,
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });


    // payment intent
    app.post('/create-payment-intent', async(req,res) => {
      const {price} = req.body
      const amount = parseInt(price * 100)
      console.log(amount, 'amount inside the intent')


      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']

      })

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })


    app.get('/payments',  async(req, res) => {
      const result = await paymentCollection.find().toArray()
      res.send(result)
    })

    app.post('/payments', async(req, res) => {
      const payment = req.body
      const paymentResult = await paymentCollection.insertOne(payment)

      console.log(payment, 'payment info')
      res.send(paymentResult)
    })


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("survey nest is running");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
