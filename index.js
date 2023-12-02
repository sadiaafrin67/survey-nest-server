require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const moment = require("moment");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
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
      const email = req?.decoded?.email;

      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;

      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      console.log("jwt", token);
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
      const query = { status: "Published" };
      const cursor = surveyCollection.find(query);
      const surveys = await cursor.toArray();
      res.send(surveys);
    });

    app.get("/survey/mysurvey/:email", verifyToken, async (req, res) => {
      const tokenEmail = req.decoded.email;
      const email = req.params.email;
      if (tokenEmail !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const cursor = surveyCollection.find(query);
      const surveys = await cursor.toArray();
      res.send(surveys);
    });

    app.get("/surveys/admin", async (req, res) => {
      const cursor = surveyCollection.find();
      const surveys = await cursor.toArray();
      res.send(surveys);
    });

    // app.get("/surveys/:id", async (req, res) => {
    //   const id = req.params.id;

    //   const query = { _id: new ObjectId(id) };
    //   const survey = await surveyCollection.findOne(query);
    //   res.send(survey);
    // });
    app.get("/surveys/:id", async (req, res) => {
      const id = req.params.id;
      const email = req.query.email;

      const query = { _id: new ObjectId(id) };
      const result = await surveyCollection.findOne(query);
      let isUserVoted = false;
      if (result) {
        if (result.vote) {
          const isvoted = result.vote.find((user) => user.email === email);
          if (isvoted) {
            isUserVoted = true;
          }
        }
      }
      res.send({ isUserVoted, result });
    });

    app.get("/surveys/feedback/:email", async (req, res) => {
      const email = req.params.email;

      const query = { email: email, feedback: { $exists: true } };
      console.log(query, "from line 136");

      const survey = await surveyCollection.find(query).toArray();
      console.log("from 139", survey);
      res.send(survey);
    });

    // app.put("/updateSurvey/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const { email, votedIn } = req.body;
    //   console.log(req.body);
    //   const survey = await surveyCollection.findOne({ _id: new ObjectId(id) });
    //   let updatedQuery;
    //   if (survey) {
    //     if (survey.votedUser) {
    //       updatedQuery = {
    //         $push: { votedUser: { email, votedIn } },
    //         $inc: {
    //           voted: 1,
    //         },
    //       };
    //     } else {
    //       updatedQuery = {
    //         $set: { votedUser: [{ email, votedIn }] },
    //         $inc: {
    //           voted: 1,
    //         },
    //       };
    //     }
    //   }
    //   const result = await surveyCollection.updateOne(
    //     { _id: new ObjectId(id) },
    //     updatedQuery
    //   );
    //   res.send(result);
    // });

    app.put("/updateSurvey/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { email, votedIn } = req.body;

        // Check if the survey with the specified id exists
        const survey = await surveyCollection.findOne({
          _id: new ObjectId(id),
        });

        let updatedQuery;

        if (survey) {
          if (survey.votedUser) {
            // Check if the email already exists in the 'votedUser' array
            const emailExists = survey.votedUser.some(
              (vote) => vote.email === email
            );

            if (emailExists) {
              // If the email already exists, send a response
              res
                .status(400)
                .send({ success: false, message: "Already voted" });
              return;
            } else {
              // If the email doesn't exist, push the new vote into the 'votedUser' array
              updatedQuery = {
                $push: { votedUser: { email, votedIn } },
                $inc: { voted: 1 },
              };
            }
          } else {
            // If the 'votedUser' array doesn't exist, create a new one with the new vote
            updatedQuery = {
              $set: { votedUser: [{ email, votedIn }] },
              $inc: { voted: 1 },
            };
          }

          const result = await surveyCollection.updateOne(
            { _id: new ObjectId(id) },
            updatedQuery
          );
          res.send(result);
        } else {
          // If the survey doesn't exist, handle accordingly (send an error response)
          res.status(404).send({ success: false, message: "Survey not found" });
        }
      } catch (error) {
        // Handle errors gracefully
        console.error("Error updating survey votedUser:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    app.patch("/surveys/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      console.log(id, req.body, "137 no");
      const query = { _id: new ObjectId(id) };
      const option = {
        upsert: true,
      };
      const updatedDoc = {
        $set: req.body,
      };
      const survey = await surveyCollection.updateOne(
        query,
        updatedDoc,
        option
      );
      res.send(survey);
    });

    app.get("/surveys/:email", async (req, res) => {
      const email = req.params.email;

      const query = { email: email, report: { $exists: true } };
      console.log(query);

      const survey = await surveyCollection.find(query).toArray();
      console.log(survey);
      res.send(survey);
    });

    //   app.get("/surveys/reports/:email", async (req, res) => {
    //     try {
    //         const email = req.params.email;

    //         // Find surveys that have a report with the specified email
    //         const surveysWithReport = await surveyCollection.find({ "report.email": email }).toArray();

    //         if (surveysWithReport.length > 0) {
    //             // Extract only the necessary information from the surveys
    //             const reports = surveysWithReport.map(survey => {
    //                 return {
    //                     surveyId: survey._id,
    //                     reports: survey.report.filter(report => report.email === email)
    //                 };
    //             });

    //             res.send({ success: true, reports });
    //         } else {
    //             res.status(404).send({ success: false, message: "No reports found for the specified email" });
    //         }
    //     } catch (error) {
    //         console.error("Error retrieving survey reports:", error);
    //         res.status(500).send({ success: false, message: "Internal server error" });
    //     }
    // });

    app.patch("/surveys/report/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { email, message } = req.body;

        // Check if the survey with the specified id exists
        const existingSurvey = await surveyCollection.findOne({
          _id: new ObjectId(id),
        });

        if (existingSurvey) {
          if (existingSurvey.report) {
            // If the 'report' array exists
            const emailExists = existingSurvey.report.some(
              (report) => report.email === email
            );

            if (emailExists) {
              // If the email already exists in the 'report' array, return a message
              res
                .status(400)
                .send({
                  success: false,
                  message: "Report already exists for this email",
                });
            } else {
              // If the email doesn't exist, push the new report into the 'report' array
              const updatedDoc = {
                $push: { report: { email, message } },
              };
              await surveyCollection.updateOne(
                { _id: new ObjectId(id) },
                updatedDoc
              );
              res.send({
                success: true,
                message: "Survey report updated successfully",
              });
            }
          } else {
            // If the 'report' array doesn't exist, create a new one with the new report
            const updatedDoc = {
              $set: { report: [{ email, message }] },
            };
            await surveyCollection.updateOne(
              { _id: new ObjectId(id) },
              updatedDoc
            );
            res.send({
              success: true,
              message: "Survey report added successfully",
            });
          }
        } else {
          // If the survey doesn't exist, handle accordingly (insert new survey or send an error response)
          res.status(404).send({ success: false, message: "Survey not found" });
        }
      } catch (error) {
        // Handle errors gracefully
        console.error("Error updating survey report:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    app.patch("/surveys/comment/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { email, message } = req.body;

        // Check if the survey with the specified id exists
        const existingSurvey = await surveyCollection.findOne({
          _id: new ObjectId(id),
        });

        if (existingSurvey) {
          if (existingSurvey.comment) {
            // If the 'report' array exists
            const emailExists = existingSurvey.comment.some(
              (comment) => comment.email === email
            );

            if (emailExists) {
              // If the email already exists in the 'report' array, return a message
              res
                .status(400)
                .send({
                  success: false,
                  message: "comment already exists for this email",
                });
            } else {
              // If the email doesn't exist, push the new report into the 'report' array
              const updatedDoc = {
                $push: { comment: { email, message } },
              };
              await surveyCollection.updateOne(
                { _id: new ObjectId(id) },
                updatedDoc
              );
              res.send({
                success: true,
                message: "Comment added successfully",
              });
            }
          } else {
            // If the 'report' array doesn't exist, create a new one with the new report
            const updatedDoc = {
              $set: { comment: [{ email, message }] },
            };
            await surveyCollection.updateOne(
              { _id: new ObjectId(id) },
              updatedDoc
            );
            res.send({ success: true, message: "Comment added successfully" });
          }
        } else {
          res.status(404).send({ success: false, message: "Survey not found" });
        }
      } catch (error) {
        // Handle errors gracefully
        console.error("Error updating survey report:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    app.post("/surveys", async (req, res) => {
      const survey = req.body;
      survey.timestamp = moment().format("MMMM Do YYYY, h:mm:ss a");
      const result = await surveyCollection.insertOne(survey);
      res.send(result);
    });

    // for like
    app.patch("/like/:id", async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $inc: { like: 1 },
      };
      const result = await surveyCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.patch("/dislike/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $inc: { dislike: 1 },
      };
      const result = await surveyCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // user related Api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
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
      let prouser = false;
      if (user?.role === "admin") {
        admin = user?.role;
      } else if (user?.role === "surveyor") {
        surveyor = user?.role;
      }
      else if(user?.role === 'Pro User'){
        prouser = user?.role
      }

      console.log("admin ?", admin);
      res.send({ admin, surveyor, prouser });
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

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { role } = req.body;
        console.log(role);
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: role,
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, "amount inside the intent");

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get("/payments", async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const email = req.body.email;
      const query = { email: email };

      const user = await userCollection.updateOne(query, {
        $set: {
          role: "Pro User",
        },
      });

      const paymentResult = await paymentCollection.insertOne(payment);

      console.log(payment, "payment info");
      res.send(paymentResult);
    });

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
